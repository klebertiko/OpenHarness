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

it("titles each tool kind in its own words, and falls back to the raw name for anything else", () => {
  const cases: Array<[string, string]> = [
    ["exec", "Executar comando"],
    ["run_command", "Executar comando"],
    ["read", "Ler arquivo"],
    ["read_file", "Ler arquivo"],
    ["discover", "Listar workspace"],
    ["list_workspace", "Listar workspace"],
    ["some_future_tool", "some_future_tool"],
  ];
  for (const [name, title] of cases) {
    const view = render(<ToolCard call={{ ...pending, name }} runId="r1" />);
    expect(screen.getByText(title)).toBeTruthy();
    view.unmount();
  }
});

it("names who asked for the call — the model or you, via a preset — and says nothing when neither applies", () => {
  const { rerender } = render(<ToolCard call={{ ...pending, origin: "model" }} runId="r1" />);
  expect(screen.getByText("· pedido pelo modelo")).toBeTruthy();
  rerender(<ToolCard call={{ ...pending, origin: "preset" }} runId="r1" />);
  expect(screen.getByText("· pedido por você")).toBeTruthy();
  rerender(<ToolCard call={{ ...pending, origin: undefined }} runId="r1" />);
  expect(screen.queryByText(/pedido pelo modelo|pedido por você/)).toBeNull();
});

it("shows a read call's path when there is no argv, and nothing when there is neither", () => {
  const { rerender } = render(<ToolCard call={{ callId: "p1", name: "read", args: "{}", path: "src/app.ts" }} runId="r1" />);
  expect(screen.getByText("src/app.ts")).toBeTruthy();
  expect(screen.queryByRole("list", { name: "argv" })).toBeNull();
  rerender(<ToolCard call={{ callId: "p2", name: "discover", args: "{}" }} runId="r1" />);
  expect(screen.queryByText("src/app.ts")).toBeNull();
});

it("explains a secret-pattern gate differently from an exec gate", () => {
  const { rerender } = render(
    <ToolCard call={{ ...pending, name: "read", path: ".env", approval: { reason: "secret_pattern", risk: "normal", riskHints: [] } }} runId="r1" />,
  );
  expect(screen.getByText(/Este caminho parece conter segredos/)).toBeTruthy();
  expect(screen.queryByText(/execução local/)).toBeNull();
  rerender(<ToolCard call={pending} runId="r1" />);
  expect(screen.getByText(/execução local, com os seus privilégios/)).toBeTruthy();
  expect(screen.queryByText(/parece conter segredos/)).toBeNull();
});

it("counts redacted secrets with correct singular/plural, and says nothing when there were none", () => {
  const base = { ...pending, approval: undefined, ok: true, exitCode: 0, result: "ok" } as ToolCall;
  const { rerender } = render(<ToolCard call={{ ...base, redactions: 1 }} runId="r1" />);
  expect(screen.getByText("1 segredo redigido")).toBeTruthy();
  rerender(<ToolCard call={{ ...base, redactions: 3 }} runId="r1" />);
  expect(screen.getByText("3 segredos redigidos")).toBeTruthy();
  rerender(<ToolCard call={{ ...base, redactions: 0 }} runId="r1" />);
  expect(screen.queryByText(/segredo/)).toBeNull();
});

it("shows the real exit code, including 0, and hides the line entirely without one", () => {
  const base = { ...pending, approval: undefined, ok: true, result: "ok" } as ToolCall;
  const { rerender } = render(<ToolCard call={{ ...base, exitCode: 0 }} runId="r1" />);
  expect(screen.getByText("exit 0")).toBeTruthy();
  rerender(<ToolCard call={{ ...base, exitCode: 1 }} runId="r1" />);
  expect(screen.getByText("exit 1")).toBeTruthy();
  rerender(<ToolCard call={{ ...base, exitCode: null }} runId="r1" />);
  expect(screen.queryByText(/^exit /)).toBeNull();
});

it("expands and collapses a long result, and never offers the toggle for a short one", () => {
  const long = "x".repeat(241);
  render(<ToolCard call={{ ...pending, approval: undefined, ok: true, result: long }} runId="r1" />);
  const toggle = screen.getByRole("button", { name: "expandir" });
  fireEvent.click(toggle);
  expect(screen.getByRole("button", { name: "recolher" })).toBeTruthy();

  cleanup();
  const short = "x".repeat(240);
  render(<ToolCard call={{ ...pending, approval: undefined, ok: true, result: short }} runId="r1" />);
  expect(screen.queryByRole("button", { name: "expandir" })).toBeNull();
});

it("records the decision note on the card once a decision has landed, and the denial note when rejected server-side", () => {
  render(<ToolCard call={{ ...pending, approval: { reason: "exec", risk: "normal", riskHints: [], decision: "approve", note: "looks fine" } }} runId="r1" />);
  expect(screen.getByText("nota: looks fine")).toBeTruthy();
  cleanup();
  render(<ToolCard call={{ ...pending, denied: { reason: "policy", note: "blocked by policy" } }} runId="r1" />);
  expect(screen.getByText("blocked by policy")).toBeTruthy();
});

it("colours the card border for high risk, a pending approval, or neither — in that priority", () => {
  const border = (el: HTMLElement) => (el.querySelector("[data-tool-card]") as HTMLElement).style.borderColor;
  const high = render(
    <ToolCard call={{ ...pending, approval: { reason: "exec", risk: "high", riskHints: [] } }} runId="r1" />,
  );
  expect(border(high.container)).toBe("var(--fault)");
  high.unmount();

  const pendingView = render(<ToolCard call={pending} runId="r1" />);
  expect(border(pendingView.container)).toBe("var(--warn)");
  pendingView.unmount();

  const neither = render(<ToolCard call={{ ...pending, approval: undefined }} runId="r1" />);
  expect(border(neither.container)).toBe("var(--line-soft)");
});
