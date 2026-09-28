import { shellNavCommands } from "@/components/shell/commands";
import { useShellStore } from "@/components/shell/shellStore";
import { useThreadStore } from "@/store/threadStore";
import type { ChatCapabilities, DiscoverItem } from "@/lib/chatToolsApi";

/**
 * A user-chosen tool, sent as `tools.preset` on `/execute/direct`
 * (contract v1.1 §2.4). `exec` always pauses on the run's approval gate.
 */
export type ToolPreset =
  | { name: "exec"; argv: string[]; cwd?: string; timeout_s?: number }
  | { name: "read"; path: string; max_bytes?: number; truncate?: boolean }
  | { name: "discover" };

export interface ChatCommand {
  id: string;
  name: string;
  description: string;
  /** Contract §1: Command = UI action · Skill = insert text · Tool = run with a preset. */
  kind: "Command" | "Skill" | "Tool";
  /** What selecting it does, in the user's words — never "executar" for a Skill. */
  hint?: "inserir" | "executar";
  run?: () => void;
  /** Skill text available synchronously (bundled with the loaded harness). */
  draft?: string;
  /** Skill text that must be read from the workspace first (contract §1 → `read`). */
  loadDraft?: () => Promise<string>;
  /** Tool: the preset the parent turns into a `/execute/direct` run. */
  preset?: ToolPreset;
  /** Tool that needs arguments typed after its name (`/exec npm test`). */
  takesArgs?: boolean;
}

/** What the composer knows about the selected workspace's tools. */
export interface ChatToolsInput {
  workspace: { root: string; name: string } | null;
  capabilities: ChatCapabilities | null;
  items: DiscoverItem[];
  /** Loads a workspace skill's text (`POST /chat/tools/read`). */
  readSkill: (path: string) => Promise<string>;
}

const SHELL_OPERATORS = new Set(["|", "||", "&&", ">", ">>", "<", ";", "&"]);

/**
 * Contract §1 splitter for `/exec`: double quotes group, backslash escapes
 * the next character inside quotes, nothing is expanded. Shell operators are
 * kept as literal argv items *and* reported, so the composer can warn that
 * there is no shell on the other side (contract §4: `shell=False`).
 */
export function splitArgv(text: string): { argv: string[]; shellSyntax: string[] } {
  const argv: string[] = [];
  let current = "";
  let inQuotes = false;
  let hasToken = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === "\\" && i + 1 < text.length) { current += text[++i]; continue; }
      if (ch === '"') { inQuotes = false; continue; }
      current += ch;
      continue;
    }
    if (ch === '"') { inQuotes = true; hasToken = true; continue; }
    if (/\s/.test(ch)) {
      if (hasToken) { argv.push(current); current = ""; hasToken = false; }
      continue;
    }
    current += ch;
    hasToken = true;
  }
  if (hasToken) argv.push(current);
  return { argv, shellSyntax: argv.filter((a) => SHELL_OPERATORS.has(a)) };
}

export function chatCommands(skills: unknown, tools?: ChatToolsInput): ChatCommand[] {
  const nav = shellNavCommands();
  const aliases = [
    ["studio", "go:studio", "Open the harness editor"],
    ["harness", "harness:library", "Browse or import an .ohm harness"],
    ["providers", "go:providers", "Manage connections and models"],
    ["automate", "go:automations", "Open scheduled work"],
  ];
  const commands: ChatCommand[] = [
    { id: "new", name: "new", description: "Start a new chat; keep your history", kind: "Command", run: () => useThreadStore.getState().startNewChat() },
    ...aliases.map(([name, id, description]) => ({ id, name, description, kind: "Command" as const, run: nav.find(command => command.id === id)!.run })),
    { id: "shortcuts", name: "shortcuts", description: "Show keyboard shortcuts", kind: "Command", run: () => useShellStore.getState().setKeymapOpen(true) },
  ];
  if (skills && typeof skills === "object" && !Array.isArray(skills)) {
    for (const [name, content] of Object.entries(skills)) {
      if (typeof content !== "string" || !content.trim()) continue;
      commands.push({ id: "skill:" + name, name: "skill:" + name, description: "From this harness · insert as an editable draft", kind: "Skill", hint: "inserir", draft: content });
    }
  }
  if (!tools?.workspace) return commands;

  const ws = tools.workspace;
  const preset = tools.capabilities?.preset ?? { read: false, exec: false };
  const { readSkill } = tools;

  for (const item of tools.items) {
    if (item.kind === "skill") {
      commands.push({
        id: "ws-skill:" + item.path, name: "skill:" + item.name, kind: "Skill", hint: "inserir",
        description: (item.description ? item.description + " · " : "") + `${ws.name} · ${item.source} · insert as an editable draft`,
        loadDraft: () => readSkill(item.path),
      });
    } else if (item.kind === "command") {
      if (item.argv?.length && preset.exec) {
        commands.push({
          id: "ws-cmd:" + item.path + ":" + item.name, name: item.name, kind: "Tool", hint: "executar",
          description: `${item.argv.join(" ")} · ${item.cwd ?? ws.name} · ${item.source} · asks for approval`,
          preset: { name: "exec", argv: item.argv, ...(item.cwd ? { cwd: item.cwd } : {}) },
        });
      } else if (!item.argv && preset.read) {
        commands.push({
          id: "ws-command:" + item.path,
          name: "command:" + item.name,
          kind: "Skill",
          hint: "inserir",
          description: (item.description ? item.description + " · " : "") + `${ws.name} · ${item.source} · insert as an editable draft`,
          loadDraft: () => readSkill(item.path),
        });
      }
    }
  }
  if (preset.exec) {
    commands.push({ id: "tool:exec", name: "exec", kind: "Tool", hint: "executar", takesArgs: true,
      description: `Run a program in ${ws.name} (no shell; approval required) · /exec npm run test` });
  }
  if (preset.read) {
    commands.push({ id: "tool:read", name: "read", kind: "Tool", hint: "executar", takesArgs: true,
      description: `Read a file from ${ws.name} into the conversation · /read README.md` });
    commands.push({ id: "tool:ls", name: "ls", kind: "Tool", hint: "executar",
      description: `List skills, commands and scripts found in ${ws.name}`, preset: { name: "discover" } });
  }
  return commands;
}
