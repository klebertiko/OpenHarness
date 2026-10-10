import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { readinessConfig, useReadinessCheck, useReadinessStore } from "./readinessStore";
import { useCanvasStore } from "@/store/canvasStore";
import { useHarnessSessionStore } from "@/store/harnessSessionStore";
import fixture from "@/lib/fixtures/ohm-roundtrip.json";

const json = (body: unknown) => new Response(JSON.stringify(body));
function Probe() {
  const r = useReadinessCheck();
  return <span data-testid="state">{r.state + "|" + r.label}</span>;
}
const state = () => screen.getByTestId("state").textContent;
const node = { id: "n1", type: "agent" as const, position: { x: 0, y: 0 }, data: { label: "Writer" } };

beforeEach(() => {
  readinessConfig.debounceMs = 0;
  useReadinessStore.setState({ panel: null });
  useHarnessSessionStore.setState({ activeBundle: structuredClone(fixture) });
  useCanvasStore.setState({ isRunning: false, nodes: [node], edges: [], harnessMeta: { id: null, name: "H", description: "" } });
  vi.stubGlobal("fetch", vi.fn(async () => json({ ok: true, errors: [] })));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("one readiness check", () => {
  it("is empty without nodes and never calls the engine", async () => {
    useCanvasStore.setState({ nodes: [], edges: [] });
    render(<Probe />);
    expect(state()).toBe("empty|Nothing to check yet");
    await act(async () => {});
    expect(fetch).not.toHaveBeenCalled();
  });

  it("checks the bundle after an edit and reports Ready to run, then problems that name a node", async () => {
    render(<Probe />);
    await waitFor(() => expect(state()).toBe("review|1 to review")); // a lone agent is a dead end (structure)
    act(() => useCanvasStore.setState({ nodes: [node, { ...node, id: "n2", type: "hitl" as const, data: { label: "Review" } }], edges: [{ id: "e", source: "n1", target: "n2" }] }));
    await waitFor(() => expect(state()).toBe("ready|Ready to run"));
    vi.mocked(fetch).mockResolvedValue(json({ ok: false, errors: ["agent n1 has no role"] }));
    act(() => useCanvasStore.getState().setHarnessMeta({ name: "H2" }));
    await waitFor(() => expect(state()).toBe("problems|1 problem"));
    expect(useReadinessStore.getState().summary.problems[0]).toMatchObject({ nodeId: "n1", label: "Writer", source: "bundle" });
  });

  it("invalidates a verdict as soon as the authored graph changes", async () => {
    useCanvasStore.setState({ nodes: [node, { ...node, id: "n2", type: "hitl" as const }], edges: [{ id: "e", source: "n1", target: "n2" }] });
    render(<Probe />);
    await waitFor(() => expect(state()).toBe("ready|Ready to run"));
    let finish!: (r: Response) => void;
    vi.mocked(fetch).mockImplementation(() => new Promise<Response>((resolve) => { finish = resolve; }));
    act(() => useCanvasStore.getState().setHarnessMeta({ name: "Changed" }));
    expect(state()).toBe("checking|Checking…");
    await waitFor(() => expect(finish).toBeTypeOf("function"));
  });

  it("discards a verdict that arrives for a draft that has since changed", async () => {
    useCanvasStore.setState({ nodes: [node, { ...node, id: "n2", type: "hitl" as const }], edges: [{ id: "e", source: "n1", target: "n2" }] });
    let older!: (r: Response) => void;
    vi.mocked(fetch)
      .mockImplementationOnce(() => new Promise<Response>((resolve) => { older = resolve; }))
      .mockResolvedValue(json({ ok: false, errors: ["New graph rejected"] }));
    render(<Probe />);
    await waitFor(() => expect(older).toBeTypeOf("function"));
    act(() => useCanvasStore.getState().setHarnessMeta({ name: "Newer graph" }));
    await waitFor(() => expect(state()).toBe("problems|1 problem"));
    await act(async () => older(json({ ok: true, errors: [] })));
    expect(state()).toBe("problems|1 problem");
  });

  it("says Engine offline when the engine cannot be reached, and Check again retries", async () => {
    useCanvasStore.setState({ nodes: [node, { ...node, id: "n2", type: "hitl" as const }], edges: [{ id: "e", source: "n1", target: "n2" }] });
    vi.mocked(fetch).mockRejectedValue(new TypeError("fetch failed"));
    render(<Probe />);
    await waitFor(() => expect(state()).toBe("offline|Engine offline"));
    vi.mocked(fetch).mockResolvedValue(json({ ok: true, errors: [] }));
    act(() => useReadinessStore.getState().recheck());
    await waitFor(() => expect(state()).toBe("ready|Ready to run"));
  });
});

describe("plan simulation", () => {
  it("returns the engine's plan and opens the plan panel", async () => {
    vi.mocked(fetch).mockResolvedValue(json({ ok: true, errors: [], steps: [{ nodeId: "n1", role: "Writer", status: "planned", note: "" }] }));
    await useReadinessStore.getState().runPlan();
    const s = useReadinessStore.getState();
    expect(s.panel).toBe("plan");
    expect(s.plan).toMatchObject({ status: "ok", message: "Simulation plan · 1 step · no provider called" });
    expect(s.plan.steps).toHaveLength(1);
  });

  it("refuses to plan while a run is in progress and drops a plan made for an older draft", async () => {
    useCanvasStore.setState({ isRunning: true });
    await useReadinessStore.getState().runPlan();
    expect(fetch).not.toHaveBeenCalled();
    useCanvasStore.setState({ isRunning: false });
    let done!: (r: Response) => void;
    vi.mocked(fetch).mockImplementation(() => new Promise<Response>((resolve) => { done = resolve; }));
    const pending = useReadinessStore.getState().runPlan();
    await waitFor(() => expect(done).toBeTypeOf("function"));
    act(() => useCanvasStore.getState().setHarnessMeta({ name: "Edited while planning" }));
    done(json({ ok: true, errors: [], steps: [] }));
    await pending;
    expect(useReadinessStore.getState().plan).toMatchObject({ status: "error", message: "The harness changed while planning. Plan again." });
  });
});
