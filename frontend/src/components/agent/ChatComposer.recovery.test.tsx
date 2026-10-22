import { useRef, useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, act } from "@testing-library/react";
import { ChatComposer } from "./ChatComposer";
import type { ChatToolsInput } from "./chatCommands";
afterEach(cleanup);
function Composer({ readSkill }: { readSkill: ChatToolsInput["readSkill"] }) {
  const [value, setValue] = useState("/skill:review");
  const ref = useRef<HTMLTextAreaElement>(null);
  return <ChatComposer value={value} onChange={setValue} onSend={vi.fn()} inputRef={ref} live={false}
    tools={{ workspace: { root: "C:/isolated", name: "Isolated" }, capabilities: { workspace: { root: "C:/isolated", name: "Isolated" }, provider_kind: "http", reason: "ok", tools: { discover: true, read: true, exec: false }, preset: { read: true, exec: false }, limits: { read_max_bytes: 1000, exec_timeout_s: 10, exec_max_timeout_s: 30, exec_output_max_bytes: 1000, max_tool_calls_per_turn: 5, max_reads_per_turn: 5 } },
      items: [{ kind: "skill", name: "review", path: "review/SKILL.md", source: "workspace" }], readSkill }} />;
}
it("retains the command and exposes recovery when a workspace skill read fails", async () => {
  HTMLElement.prototype.scrollIntoView = vi.fn();
  render(<Composer readSkill={vi.fn().mockRejectedValue(new Error("offline"))} />);
  fireEvent.click(screen.getByRole("option", { name: /skill:review/ }));
  await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("choose it again"));
  expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("/skill:review");
});
it("does not overwrite newer typing when a skill read completes late", async () => {
  let resolveRead!: (value: string) => void;
  render(<Composer readSkill={() => new Promise((resolve) => { resolveRead = resolve; })} />);
  fireEvent.click(screen.getByRole("option", { name: /skill:review/ }));
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "Newer draft" } });
  await act(async () => resolveRead("stale skill"));
  expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("Newer draft");
});
