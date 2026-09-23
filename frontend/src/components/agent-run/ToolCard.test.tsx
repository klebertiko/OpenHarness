import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { ToolCard } from "./ToolCard";
import type { ToolCall } from "./types";
import { useReadDisclosureStore } from "./readDisclosure";

// CHAT-TOOLS-FE AC#3/#4 — features/chat-tools-menu.feature, literal scenario
// names. The card is the last line of defence named by the threat-model (T5,
// approval fatigue): argv as a list, the "local execution with your
// privileges" sentence, and a visible high-risk label.

vi.mock("./runClient", () => ({ sendControl: vi.fn(async () => undefined) }));
import { sendControl } from "./runClient";

const pending: ToolCall = {
  callId: "c1", name: "exec", args: '{"argv":["npm","run","test"]}', argv: ["npm", "run", "test"],
  approval: { reason: "exec", risk: "normal", riskHints: [] },
};

beforeEach(() => vi.clearAllMocks());
afterEach(() => { cleanup(); useReadDisclosureStore.getState().reset(); });

it("Approval card shows argv as a list and waits", () => {
  render(<ToolCard call={pending} runId="r1" />);
  const items = screen.getAllByRole("listitem").map((li) => li.textContent);
  expect(items).toEqual(["npm", "run", "test"]);
  expect(screen.getByText(/execução local, com os seus privilégios/)).toBeTruthy();
  expect(screen.getByRole("button", { name: "Aprovar" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Rejeitar" })).toBeTruthy();
  expect(sendControl).not.toHaveBeenCalled();
});

it("High-risk approval card is visibly different", () => {
  render(<ToolCard call={{ ...pending, argv: ["git", "reset", "--hard"], approval: { reason: "exec", risk: "high", riskHints: ["git reset --hard"] } }} runId="r1" />);
  expect(screen.getByText("alto risco")).toBeTruthy();
  expect(screen.getByText("git reset --hard", { selector: "[data-hint]" })).toBeTruthy();
});

it("Approve sends one control decision for that call", () => {
  const { rerender } = render(<ToolCard call={pending} runId="r1" />);
  fireEvent.click(screen.getByRole("button", { name: "Aprovar" }));
  expect(sendControl).toHaveBeenCalledTimes(1);
  expect(sendControl).toHaveBeenCalledWith("r1", { action: "resume", decision: "approve", call_id: "c1", note: "" });
  // A second click before the SSE decision lands must not send again.
  fireEvent.click(screen.getByRole("button", { name: "Aprovar" }));
  expect(sendControl).toHaveBeenCalledTimes(1);
  rerender(<ToolCard call={{ ...pending, approval: { ...pending.approval!, decision: "approve" } }} runId="r1" />);
  expect(screen.getByText("aprovado")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Aprovar" })).toBeNull();
});

it("Tool result states render correctly", () => {
  const { rerender } = render(<ToolCard call={{ ...pending, approval: { ...pending.approval!, decision: "approve" }, ok: false, timedOut: true, exitCode: null, result: "" }} runId="r1" />);
  expect(screen.getByText("timeout")).toBeTruthy();
  rerender(<ToolCard call={{ ...pending, approval: { ...pending.approval!, decision: "approve" }, ok: true, truncated: true, exitCode: 0, result: "x…[truncated at 65536 bytes]" }} runId="r1" />);
  expect(screen.getByText("saída truncada")).toBeTruthy();
  rerender(<ToolCard call={{ ...pending, denied: { reason: "rejected", note: "no" } }} runId="r1" />);
  expect(screen.getByText("rejeitado")).toBeTruthy();
  rerender(<ToolCard call={{ ...pending, approval: undefined, ok: true, simulated: true, result: "[mock] would run: npm run test" }} runId="r1" />);
  expect(screen.getByText("simulado")).toBeTruthy();
});

it("renders every broker state with its distinct label and tone", () => {
  const cases: Array<[Partial<ToolCall>, string, string]> = [
    [{ denied: { reason: "rejected", note: "no" } }, "rejeitado", "var(--fault)"],
    [{ denied: { reason: "approval_timeout", note: "late" } }, "sem resposta", "var(--fault)"],
    [{ denied: { reason: "policy", note: "policy" } }, "bloqueado", "var(--fault)"],
    [{ approval: undefined, simulated: true }, "simulado", "var(--ink-faint)"],
    [{ approval: undefined, timedOut: true }, "timeout", "var(--fault)"],
    [{ approval: undefined, ok: false }, "falhou", "var(--fault)"],
    [{ approval: undefined, ok: true }, "concluído", "var(--ok, var(--ink-mute))"],
    [{ approval: { reason: "exec", risk: "normal", riskHints: [], decision: "approve" } }, "aprovado", "var(--signal)"],
    [{ approval: { reason: "exec", risk: "normal", riskHints: [], decision: "reject" } }, "rejeitado", "var(--fault)"],
    [{ approval: undefined }, "executando", "var(--signal)"],
  ];
  for (const [overrides, label, color] of cases) {
    const view = render(<ToolCard call={{ ...pending, ...overrides }} runId="r1" />);
    const status = screen.getByText(label);
    if (color !== "var(--ok, var(--ink-mute))") {
      expect(status.getAttribute("style")).toContain(`color: ${color}`);
    }
    view.unmount();
  }
});

it("never decides without a run id and sends a rejection note exactly once", () => {
  const { rerender } = render(<ToolCard call={pending} runId={null} />);
  expect((screen.getByRole("button", { name: "Aprovar" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Aprovar" }));
  expect(sendControl).not.toHaveBeenCalled();

  rerender(<ToolCard call={pending} runId="r2" />);
  fireEvent.change(screen.getByRole("textbox", { name: "Nota da decisão" }), { target: { value: "not now" } });
  fireEvent.click(screen.getByRole("button", { name: "Rejeitar" }));
  fireEvent.click(screen.getByRole("button", { name: "Rejeitar" }));
  expect(sendControl).toHaveBeenCalledTimes(1);
  expect(sendControl).toHaveBeenCalledWith("r2", { action: "resume", decision: "reject", call_id: "c1", note: "not now" });
});

it("First read on a remote provider discloses where content goes", () => {
  const openrouter = { provider: "openrouter", residence: "cloud" } as const;
  const done: ToolCall = { callId: "r1", name: "read", args: '{"path":"README.md"}', path: "README.md", origin: "model", ok: true, result: "# Hi" };
  render(<ToolCard call={done} runId="run" connection={openrouter} />);
  expect(screen.getByText("arquivos lidos são enviados a openrouter")).toBeTruthy();
  // Second read in the same session: the sentence is not repeated (no notice fatigue).
  render(<ToolCard call={{ ...done, callId: "r2" }} runId="run" connection={openrouter} />);
  expect(screen.getAllByText("arquivos lidos são enviados a openrouter")).toHaveLength(1);
  // A local provider never gets the sentence.
  cleanup(); useReadDisclosureStore.getState().reset();
  render(<ToolCard call={done} runId="run" connection={{ provider: "ollama", residence: "local" }} />);
  expect(screen.queryByText(/arquivos lidos são enviados/)).toBeNull();
});

it("discloses a remote read when the result arrives after the card mounted", () => {
  const connection = { provider: "openrouter", residence: "cloud" } as const;
  const call: ToolCall = { callId: "late", name: "read", args: '{}', path: "README.md", origin: "model" };
  const { rerender } = render(<ToolCard call={call} runId="run" connection={connection} />);
  expect(screen.queryByText(/arquivos lidos são enviados/)).toBeNull();
  rerender(<ToolCard call={{ ...call, ok: true, result: "content" }} runId="run" connection={connection} />);
  expect(screen.getByText("arquivos lidos são enviados a openrouter")).toBeTruthy();
});
