import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

vi.mock("@/lib/copilot/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/copilot/api")>();
  return { ...actual, planGraphEdit: vi.fn() };
});

import { CopilotApiError, planGraphEdit } from "@/lib/copilot/api";
import { goldenBaseCanvas } from "@/lib/copilot/testGraph";
import type { PlanResponse } from "@/lib/copilot/contract";
import { useShellStore } from "@/components/shell/shellStore";
import { useCanvasStore } from "./canvasStore";
import { useCopilotStore } from "./copilotStore";

const examples = JSON.parse(
  readFileSync(path.resolve(__dirname, "../../../backend/studio_copilot/contract_examples.json"), "utf8"),
) as { cases: { name: string; ops: PlanResponse["ops"] }[] };
const addAndWire = examples.cases.find((c) => c.name === "add_and_wire")!.ops;

const plan = (over: Partial<PlanResponse> = {}): PlanResponse => ({ summary: "Added a Reviewer.", ops: addAndWire, source: "model", tokens: 12, ...over });

const canvas = () => useCanvasStore.getState();
const copilot = () => useCopilotStore.getState();
const mockPlan = vi.mocked(planGraphEdit);

beforeEach(() => {
  mockPlan.mockReset();
  useCanvasStore.setState({ isRunning: false, _history: [], _historyIndex: -1 });
  const g = goldenBaseCanvas();
  canvas().loadGraph(g.nodes, g.edges);
  copilot().reset();
  useCopilotStore.setState({ open: false, tab: "inspector" });
});

describe("copilotStore.send", () => {
  it("applies a plan as one undo step, marks the new node and records the proposal", async () => {
    mockPlan.mockResolvedValue(plan());
    const beforeEdges = structuredClone(canvas().edges);
    await copilot().send("add a reviewer", { mode: "live", connectionId: "conn-1" });

    expect(mockPlan.mock.calls[0][0]).toMatchObject({ message: "add a reviewer", mode: "live", connection_id: "conn-1" });
    expect(canvas().nodes).toHaveLength(5);
    const added = canvas().nodes.find((n) => !["a1", "g1", "h1", "s1"].includes(n.id))!;
    const turns = copilot().turns;
    expect(turns.map((t) => t.role)).toEqual(["user", "assistant"]);
    expect(turns[1]).toMatchObject({ text: "Added a Reviewer.", source: "model" });
    expect(turns[1].proposal).toMatchObject({ seq: canvas().headSeq(), state: "open" });
    expect(turns[1].proposal!.lines).toHaveLength(3);
    expect(copilot().marks).toEqual({ [added.id]: "added" });
    expect(copilot().status).toBe("idle");

    copilot().undo(turns[1].id);
    expect(canvas().nodes).toHaveLength(4);
    expect(canvas().edges).toEqual(beforeEdges);
    expect(copilot().turns[1].proposal!.state).toBe("undone");
    expect(copilot().marks).toEqual({});
  });

  it("sends only the allowlisted graph, never credentials", async () => {
    mockPlan.mockResolvedValue(plan({ ops: [] }));
    canvas().updateNodeData("a1", { secretRef: "vault://k", endpoint: "https://x.test", providerIds: ["p"] });
    await copilot().send("hello", { mode: "mock" });
    const sent = JSON.stringify(mockPlan.mock.calls[0][0]);
    expect(sent).not.toMatch(/vault:\/\/k|x\.test|secretRef|providerIds/);
  });

  it("an empty op list adds an assistant turn with no proposal", async () => {
    mockPlan.mockResolvedValue(plan({ summary: "Which steps do you want?", ops: [] }));
    await copilot().send("hmm", { mode: "mock" });
    expect(copilot().turns[1].proposal).toBeUndefined();
    expect(canvas().nodes).toHaveLength(4);
  });

  it("after a manual edit Undo is unavailable and does not touch the canvas", async () => {
    mockPlan.mockResolvedValue(plan());
    await copilot().send("add a reviewer", { mode: "mock" });
    const id = copilot().turns[1].id;
    expect(copilot().undoAvailable(id)).toBe(true);
    canvas().addNode({ id: "manual", type: "agent", position: { x: 0, y: 400 }, data: { label: "Manual" } });
    expect(copilot().undoAvailable(id)).toBe(false);
    copilot().undo(id);
    expect(canvas().nodes).toHaveLength(6);
    expect(copilot().turns[1].proposal!.state).toBe("open");
  });

  it("does not apply when the live graph drifted during the request", async () => {
    mockPlan.mockImplementation(async () => {
      canvas().removeNode("g1");
      return plan();
    });
    await copilot().send("add a reviewer", { mode: "mock" });
    expect(canvas().nodes.map((n) => n.id)).toEqual(["a1", "h1", "s1"]);
    const last = copilot().turns.at(-1)!;
    expect(last.error).toMatchObject({ text: "The graph changed while Copilot was working", retry: "add a reviewer" });
    expect(last.proposal).toBeUndefined();
    expect(copilot().marks).toEqual({});
  });

  it("refuses to apply while a run owns the graph", async () => {
    mockPlan.mockImplementation(async () => {
      canvas().setRunning(true);
      return plan();
    });
    await copilot().send("add a reviewer", { mode: "mock" });
    expect(canvas().nodes).toHaveLength(4);
    expect(copilot().turns.at(-1)!.error!.text).toBe("Stop the run to apply changes");
  });

  it.each([
    [new CopilotApiError(422, { error: "plan_invalid" }), "didn't fit the graph rules"],
    [new CopilotApiError(400, { error: "provider_unavailable", detail: "Paste an Anthropic key to send" }), "Paste an Anthropic key to send"],
    [new CopilotApiError(402, { error: "budget_exceeded", detail: "Monthly budget reached" }), "Monthly budget reached"],
    [new CopilotApiError(504, { error: "provider_timeout" }), "took too long"],
    [new CopilotApiError(413, { error: "payload_too_large" }), "too large"],
    [new TypeError("fetch failed"), "reach"],
  ])("maps %o to a human error with a retry", async (err, fragment) => {
    mockPlan.mockRejectedValue(err);
    await copilot().send("do it", { mode: "mock" });
    const last = copilot().turns.at(-1)!;
    expect(last.role).toBe("assistant");
    expect(last.error!.text).toContain(fragment);
    expect(last.error!.retry).toBe("do it");
    expect(copilot().status).toBe("idle");
  });

  it("a 402 offers a way to Providers", async () => {
    mockPlan.mockRejectedValue(new CopilotApiError(402, { error: "budget_exceeded", detail: "Monthly budget reached" }));
    await copilot().send("do it", { mode: "live", connectionId: "c" });
    expect(copilot().turns.at(-1)!.error!.link).toBe("providers");
  });

  it("cancel aborts the request, returns to idle and adds no assistant turn", async () => {
    mockPlan.mockImplementation(
      (_req, signal) =>
        new Promise((_, reject) => signal!.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")))),
    );
    const pending = copilot().send("slow", { mode: "mock" });
    expect(copilot().status).toBe("working");
    copilot().cancel();
    await pending;
    expect(copilot().status).toBe("idle");
    expect(copilot().turns.map((t) => t.role)).toEqual(["user"]);
  });

  it("sending a new prompt auto-keeps the previous open proposal", async () => {
    mockPlan.mockResolvedValueOnce(plan());
    await copilot().send("first", { mode: "mock" });
    const first = copilot().turns[1].id;
    mockPlan.mockResolvedValueOnce(plan({ summary: "Nothing to change.", ops: [] }));
    await copilot().send("second", { mode: "mock" });
    expect(copilot().turns.find((t) => t.id === first)!.proposal!.state).toBe("kept");
    expect(copilot().marks).toEqual({});
  });

  it("keep clears the marks and collapses the proposal", async () => {
    mockPlan.mockResolvedValue(plan());
    await copilot().send("add", { mode: "mock" });
    copilot().keep(copilot().turns[1].id);
    expect(copilot().turns[1].proposal!.state).toBe("kept");
    expect(copilot().marks).toEqual({});
  });

  it("sends at most the last 6 summaries as history, without error turns", async () => {
    mockPlan.mockResolvedValue(plan({ ops: [] }));
    for (let i = 0; i < 5; i++) await copilot().send(`turn ${i}`, { mode: "mock" });
    mockPlan.mockRejectedValueOnce(new Error("boom"));
    await copilot().send("bad", { mode: "mock" });
    mockPlan.mockResolvedValue(plan({ ops: [] }));
    await copilot().send("last", { mode: "mock" });
    const history = mockPlan.mock.calls.at(-1)![0].history;
    expect(history.length).toBeLessThanOrEqual(6);
    expect(history.every((h) => !h.text.includes("couldn't"))).toBe(true);
  });

  it("reset clears turns, marks and cancels work", async () => {
    mockPlan.mockResolvedValue(plan());
    await copilot().send("add", { mode: "mock" });
    copilot().reset();
    expect(copilot().turns).toEqual([]);
    expect(copilot().marks).toEqual({});
    expect(copilot().status).toBe("idle");
  });
});

describe("copilotStore navigation", () => {
  it("openCopilot opens the Copilot tab and the right column", () => {
    useShellStore.setState({ rightOpen: false });
    copilot().openCopilot();
    expect(copilot()).toMatchObject({ open: true, tab: "copilot" });
    expect(useShellStore.getState().rightOpen).toBe(true);
    copilot().close();
    expect(copilot()).toMatchObject({ open: false, tab: "inspector" });
  });
});
