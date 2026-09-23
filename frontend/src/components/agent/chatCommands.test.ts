import { beforeEach, describe, expect, it, vi } from "vitest";

import { useShellStore } from "@/components/shell/shellStore";
import { useThreadStore } from "@/store/threadStore";

import { chatCommands, splitArgv, type ChatToolsInput } from "./chatCommands";

// CHAT-TOOLS-FE AC#1/#2/#5 — pure-function half of
// features/chat-tools-menu.feature. Scenario names are kept literal so the
// BE (pytest-bdd) and FE (Vitest) reports line up by title.

const workspace = { root: "D:\\Development", name: "Development" };
const capabilities = {
  workspace,
  provider_kind: "http" as const,
  tools: { discover: true, read: true, exec: true },
  preset: { read: true, exec: true },
  reason: "ok" as const,
  limits: {
    read_max_bytes: 262144, exec_timeout_s: 60, exec_max_timeout_s: 600,
    exec_output_max_bytes: 65536, max_tool_calls_per_turn: 8, max_reads_per_turn: 20,
  },
};
const discovered: ChatToolsInput["items"] = [
  { kind: "skill", name: "harness", path: ".claude/skills/harness/SKILL.md", description: "Agile harness", source: "claude-skills" },
  { kind: "command", name: "test", path: "frontend/package.json", argv: ["npm", "run", "test"], cwd: "frontend", source: "package-scripts" },
];

beforeEach(() => {
  useShellStore.setState({ section: "chats", libraryOpen: false, keymapOpen: false });
  useThreadStore.setState({ activeThreadId: null, threads: [], messagesByThread: {} });
});

describe("chatCommands with workspace tools", () => {
  it("Typing slash shows Command, Skill and Tool sections", () => {
    const commands = chatCommands({}, { workspace, capabilities, items: discovered, readSkill: vi.fn() });
    const kinds = new Set(commands.map((c) => c.kind));
    expect(kinds).toEqual(new Set(["Command", "Skill", "Tool"]));
    expect(commands.find((c) => c.name === "new")?.kind).toBe("Command");
    expect(commands.find((c) => c.name === "skill:harness")?.kind).toBe("Skill");
    expect(commands.find((c) => c.name === "exec")?.kind).toBe("Tool");
  });

  it("Selecting a Skill inserts a draft and never executes", async () => {
    const readSkill = vi.fn(async () => "# harness\nbody");
    const commands = chatCommands({}, { workspace, capabilities, items: discovered, readSkill });
    const skill = commands.find((c) => c.name === "skill:harness")!;
    expect(skill.hint).toBe("inserir");
    expect(skill.preset).toBeUndefined();
    expect(skill.run).toBeUndefined();
    await expect(skill.loadDraft!()).resolves.toBe("# harness\nbody");
    expect(readSkill).toHaveBeenCalledWith(".claude/skills/harness/SKILL.md");
  });

  it("A discovered prompt command without argv inserts its file instead of crashing", async () => {
    const readSkill = vi.fn(async () => "Review this change");
    const items: ChatToolsInput["items"] = [
      { kind: "command", name: "review", path: ".claude/commands/review.md", description: "Review", source: "claude-commands" },
    ];
    const commands = chatCommands({}, { workspace, capabilities, items, readSkill });
    const command = commands.find((item) => item.name === "command:review")!;
    expect(command.kind).toBe("Skill");
    expect(command.hint).toBe("inserir");
    expect(command.preset).toBeUndefined();
    await expect(command.loadDraft!()).resolves.toBe("Review this change");
    expect(readSkill).toHaveBeenCalledWith(".claude/commands/review.md");
  });

  it("Selecting a Tool starts a run with a preset", () => {
    const commands = chatCommands({}, { workspace, capabilities, items: discovered, readSkill: vi.fn() });
    const tool = commands.find((c) => c.name === "test" && c.kind === "Tool")!;
    expect(tool.hint).toBe("executar");
    expect(tool.preset).toEqual({ name: "exec", argv: ["npm", "run", "test"], cwd: "frontend" });
    expect(tool.draft).toBeUndefined();
  });

  it("builds the complete workspace Tool contract and honors disabled capabilities", () => {
    const commands = chatCommands({}, { workspace, capabilities, items: discovered, readSkill: vi.fn() });
    expect(commands.filter((c) => c.kind === "Tool").map(({ id, name, hint, takesArgs, description, preset }) =>
      ({ id, name, hint, takesArgs, description, preset }))).toEqual([
      { id: "ws-cmd:frontend/package.json:test", name: "test", hint: "executar", takesArgs: undefined,
        description: "npm run test · frontend · package-scripts · asks for approval",
        preset: { name: "exec", argv: ["npm", "run", "test"], cwd: "frontend" } },
      { id: "tool:exec", name: "exec", hint: "executar", takesArgs: true,
        description: "Run a program in Development (no shell; approval required) · /exec npm run test", preset: undefined },
      { id: "tool:read", name: "read", hint: "executar", takesArgs: true,
        description: "Read a file from Development into the conversation · /read README.md", preset: undefined },
      { id: "tool:ls", name: "ls", hint: "executar", takesArgs: undefined,
        description: "List skills, commands and scripts found in Development", preset: { name: "discover" } },
    ]);

    const disabled = chatCommands({}, { workspace, capabilities: null, items: discovered, readSkill: vi.fn() });
    expect(disabled.some((c) => c.kind === "Tool")).toBe(false);
  });

  it("No workspace hides tools and says why", () => {
    const commands = chatCommands({}, { workspace: null, capabilities: null, items: [], readSkill: vi.fn() });
    expect(commands.some((c) => c.kind === "Tool")).toBe(false);
  });

  it("Mock provider never offers exec as a Tool", () => {
    const mock = { ...capabilities, provider_kind: "mock" as const, reason: "mock" as const, preset: { read: true, exec: false } };
    const commands = chatCommands({}, { workspace, capabilities: mock, items: discovered, readSkill: vi.fn() });
    expect(commands.find((c) => c.name === "exec")).toBeUndefined();
    expect(commands.find((c) => c.name === "read")?.kind).toBe("Tool");
    expect(commands.find((c) => c.name === "test" && c.kind === "Tool")).toBeUndefined();
  });

  it("keeps the harness-bundled skills as insertable drafts", () => {
    const commands = chatCommands({ review: "# review" }, { workspace, capabilities, items: [], readSkill: vi.fn() });
    const skill = commands.find((c) => c.name === "skill:review")!;
    expect(skill.kind).toBe("Skill");
    expect(skill.draft).toBe("# review");
    expect(skill.hint).toBe("inserir");
  });
});

describe("splitArgv (contract §1: shlex-like, no shell)", () => {
  it("groups double-quoted words and keeps everything else literal", () => {
    expect(splitArgv('npm run test -- --grep "menu shows"')).toEqual({ argv: ["npm", "run", "test", "--", "--grep", "menu shows"], shellSyntax: [] });
  });

  it("does not expand variables and reports shell operators instead of applying them", () => {
    expect(splitArgv("echo $HOME | cat && ls > out")).toEqual({
      argv: ["echo", "$HOME", "|", "cat", "&&", "ls", ">", "out"],
      shellSyntax: ["|", "&&", ">"],
    });
  });
});
