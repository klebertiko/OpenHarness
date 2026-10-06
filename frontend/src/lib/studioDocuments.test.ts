import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useCanvasStore } from "@/store/canvasStore";
import { useShellStore } from "@/components/shell/shellStore";
import { api } from "./api";
import type { HarnessEdge, HarnessNode } from "./types";
import {
  flushAutosave, hasStudioDraft, markClean, openSavedHarness, removeSavedHarness, replaceStudioCanvas, startAutosave,
  stripRuntime, useStudioDocsStore,
} from "./studioDocuments";

vi.mock("./api", () => ({
  api: { harnesses: { list: vi.fn(), get: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() } },
}));
const h = vi.mocked(api.harnesses);

const node = (id: string, extra: Partial<HarnessNode["data"]> = {}): HarnessNode => ({
  id, type: "agent", position: { x: 10, y: 20 }, data: { label: id, ...extra } as HarnessNode["data"],
});
const UNTITLED = { id: null, name: "Untitled harness", description: "" };
let stop: (() => void) | null = null;

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  h.list.mockResolvedValue([]);
  h.create.mockResolvedValue({ id: "h1", name: "x" });
  h.update.mockResolvedValue({ id: "h1", name: "x" });
  h.delete.mockResolvedValue(new Response(null, { status: 204 }));
  useCanvasStore.setState({ nodes: [], edges: [], isRunning: false, selectedNodeId: null, harnessMeta: { ...UNTITLED } });
  useShellStore.setState({ section: "studio", studioView: "overview" });
  useStudioDocsStore.setState({ items: [], loaded: false, error: "", saveState: "idle" });
  markClean();
  stop = startAutosave();
});
afterEach(() => { stop?.(); vi.useRealTimers(); });

const edit = async (fn: () => void) => { fn(); await vi.advanceTimersByTimeAsync(1000); };

it("an untouched new harness is not a draft and is never saved", async () => {
  expect(hasStudioDraft(useCanvasStore.getState())).toBe(false);
  await edit(() => useCanvasStore.getState().setHarnessMeta({ name: "Untitled Harness", description: " " }));
  expect(h.create).not.toHaveBeenCalled();
});

it("the first real edit creates a saved harness on disk, later edits update that same record", async () => {
  await edit(() => useCanvasStore.getState().addNode(node("a")));
  expect(h.create).toHaveBeenCalledOnce();
  expect(useCanvasStore.getState().harnessMeta.id).toBe("h1");
  expect(useStudioDocsStore.getState().saveState).toBe("saved");
  await edit(() => useCanvasStore.getState().setHarnessMeta({ name: "Triage loop" }));
  expect(h.create).toHaveBeenCalledOnce();
  expect(h.update).toHaveBeenCalledWith("h1", expect.objectContaining({ name: "Triage loop" }));
});

it("never stores run output, only authored content", async () => {
  await edit(() => useCanvasStore.getState().addNode(node("a", { status: "complete", output: "run text", tokens: 9, latencyMs: 3, error: "x" })));
  const graph = h.create.mock.calls[0][2];
  expect(graph.nodes[0].data).toEqual({ label: "a" });
  const e = { id: "e", source: "a", target: "b", data: { label: "pass", live: true } } as HarnessEdge;
  expect(stripRuntime({ nodes: [], edges: [e] }).edges[0].data).toEqual({ label: "pass" });
});

it("opening a sample does not save anything until the person edits it", async () => {
  await edit(() => { useCanvasStore.getState().loadGraph([node("s")], []); markClean(); });
  expect(h.create).not.toHaveBeenCalled();
});

it("a failed save is reported, not hidden, and the next edit retries", async () => {
  h.create.mockRejectedValueOnce(new Error("offline"));
  await edit(() => useCanvasStore.getState().addNode(node("a")));
  expect(useStudioDocsStore.getState().saveState).toBe("error");
  await edit(() => useCanvasStore.getState().addNode(node("b")));
  expect(h.create).toHaveBeenCalledTimes(2);
  expect(useStudioDocsStore.getState().saveState).toBe("saved");
});

it("flushAutosave saves pending edits immediately", async () => {
  useCanvasStore.getState().addNode(node("a"));
  await flushAutosave();
  expect(h.create).toHaveBeenCalledOnce();
});

it("opens a saved harness into the editor without re-saving it", async () => {
  h.get.mockResolvedValue({ id: "h9", name: "Saved one", description: "d", created_at: "", updated_at: "",
    graph_json: { nodes: [node("x", { status: "complete", output: "old" })], edges: [] } });
  await openSavedHarness("h9");
  await vi.advanceTimersByTimeAsync(1000);
  const s = useCanvasStore.getState();
  expect(s.harnessMeta).toEqual({ id: "h9", name: "Saved one", description: "d" });
  expect(s.nodes[0].data).toEqual({ label: "x" });
  expect(useShellStore.getState().studioView).toBe("editor");
  expect(h.update).not.toHaveBeenCalled();
});

it("deleting the open harness removes it from disk and leaves an empty, unsaved canvas", async () => {
  useCanvasStore.setState({ nodes: [node("a")], harnessMeta: { id: "h1", name: "Mine", description: "" } });
  markClean();
  useStudioDocsStore.setState({ items: [{ id: "h1", name: "Mine", description: "", created_at: "", updated_at: "" }] });
  await removeSavedHarness("h1");
  await vi.advanceTimersByTimeAsync(1000);
  expect(h.delete).toHaveBeenCalledWith("h1");
  expect(useCanvasStore.getState().nodes).toEqual([]);
  expect(useCanvasStore.getState().harnessMeta.id).toBeNull();
  expect(useStudioDocsStore.getState().items).toEqual([]);
  expect(h.create).not.toHaveBeenCalled();
});

it("deleting another harness keeps the open one", async () => {
  useCanvasStore.setState({ nodes: [node("a")], harnessMeta: { id: "h1", name: "Mine", description: "" } });
  await removeSavedHarness("h2");
  expect(useCanvasStore.getState().nodes).toHaveLength(1);
});

it("a refused delete surfaces an error and keeps the record listed", async () => {
  h.delete.mockResolvedValue(new Response("nope", { status: 500 }));
  useStudioDocsStore.setState({ items: [{ id: "h2", name: "Other", description: "", created_at: "", updated_at: "" }] });
  await expect(removeSavedHarness("h2")).rejects.toThrow();
  expect(useStudioDocsStore.getState().items).toHaveLength(1);
});

it("will not open or delete the open harness while it is running", async () => {
  useCanvasStore.setState({ isRunning: true, harnessMeta: { id: "h1", name: "Mine", description: "" } });
  await expect(openSavedHarness("h9")).rejects.toThrow(/run/i);
  await expect(removeSavedHarness("h1")).rejects.toThrow(/run/i);
  expect(h.delete).not.toHaveBeenCalled();
});

it("refresh lists saved harnesses and reports an unreachable engine honestly", async () => {
  h.list.mockResolvedValueOnce([{ id: "h1", name: "A", description: "", created_at: "", updated_at: "" }]);
  await useStudioDocsStore.getState().refresh();
  expect(useStudioDocsStore.getState().items.map((i) => i.id)).toEqual(["h1"]);
  h.list.mockRejectedValueOnce(new Error("down"));
  await useStudioDocsStore.getState().refresh();
  expect(useStudioDocsStore.getState().error).toMatch(/engine/i);
});

it("tracks whether the open harness has unsaved edits", async () => {
  expect(useStudioDocsStore.getState().dirty).toBe(false);
  useCanvasStore.getState().addNode(node("a"));
  expect(useStudioDocsStore.getState().dirty).toBe(true);
  await vi.advanceTimersByTimeAsync(1000);
  expect(useStudioDocsStore.getState().dirty).toBe(false);
  useCanvasStore.getState().loadGraph([node("s")], []);
  markClean();
  expect(useStudioDocsStore.getState().dirty).toBe(false);
});

// ── QA bounce (PR #37) — each case reproduces a reported bug ──────────────
const deferred = <T,>() => { let resolve!: (v: T) => void; const p = new Promise<T>((r) => { resolve = r; }); return { p, resolve }; };
const openSaved = (id: string, name: string) => {
  useCanvasStore.setState({ nodes: [node("a")], edges: [], harnessMeta: { id, name, description: "" } });
  markClean();
};

it("selecting or measuring nodes is not an edit", async () => {
  openSaved("h1", "Mine");
  await edit(() => useCanvasStore.getState().onNodesChange([{ id: "a", type: "select", selected: true }]));
  await edit(() => useCanvasStore.getState().onNodesChange([{ id: "a", type: "dimensions", dimensions: { width: 200, height: 80 }, setAttributes: true }]));
  expect(h.update).not.toHaveBeenCalled();
  expect(h.create).not.toHaveBeenCalled();
});

it("dragging a node to a new place is an edit", async () => {
  openSaved("h1", "Mine");
  await edit(() => useCanvasStore.getState().onNodesChange([{ id: "a", type: "position", position: { x: 99, y: 99 } }]));
  expect(h.update).toHaveBeenCalledOnce();
});

it("replacing the canvas saves pending edits of the previous harness first", async () => {
  openSaved("h1", "Mine");
  useCanvasStore.getState().addNode(node("b"));
  replaceStudioCanvas(() => {
    useCanvasStore.getState().loadGraph([node("s")], []);
    useCanvasStore.getState().setHarnessMeta({ id: null, name: "Sample", description: "" });
  });
  await vi.advanceTimersByTimeAsync(1000);
  expect(h.update).toHaveBeenCalledOnce();
  expect(h.update.mock.calls[0][0]).toBe("h1");
  expect(h.update.mock.calls[0][1].graph_json!.nodes.map((n) => n.id)).toEqual(["a", "b"]);
  expect(h.create).not.toHaveBeenCalled();
});

it("a create still in flight never stamps its id onto the harness opened meanwhile", async () => {
  const d = deferred<{ id: string; name: string }>();
  h.create.mockReturnValueOnce(d.p);
  useCanvasStore.getState().addNode(node("a"));
  await vi.advanceTimersByTimeAsync(600);
  expect(h.create).toHaveBeenCalledOnce();
  replaceStudioCanvas(() => {
    useCanvasStore.getState().loadGraph([node("imp")], []);
    useCanvasStore.getState().setHarnessMeta({ id: null, name: "Imported", description: "" });
  });
  d.resolve({ id: "OLD", name: "x" });
  await vi.advanceTimersByTimeAsync(1000);
  expect(useCanvasStore.getState().harnessMeta.id).not.toBe("OLD");
  await edit(() => useCanvasStore.getState().addNode(node("more")));
  expect(h.update.mock.calls.map((c) => c[0])).not.toContain("OLD");
});

it("edits queued behind an in-flight create update the same record, never a second create", async () => {
  const d = deferred<{ id: string; name: string }>();
  h.create.mockReturnValueOnce(d.p);
  useCanvasStore.getState().addNode(node("a"));
  await vi.advanceTimersByTimeAsync(600);
  useCanvasStore.getState().addNode(node("b"));
  await vi.advanceTimersByTimeAsync(600);
  d.resolve({ id: "h1", name: "x" });
  await vi.advanceTimersByTimeAsync(1000);
  expect(h.create).toHaveBeenCalledOnce();
  expect(h.update).toHaveBeenCalledWith("h1", expect.anything());
  expect(h.update.mock.calls.at(-1)![1].graph_json!.nodes.map((n) => n.id)).toEqual(["a", "b"]);
});

it("deleting the open harness drops its pending autosave instead of recreating it", async () => {
  openSaved("h1", "Mine");
  useStudioDocsStore.setState({ items: [{ id: "h1", name: "Mine", description: "", created_at: "", updated_at: "" }] });
  const d = deferred<Response>();
  h.delete.mockReturnValueOnce(d.p);
  useCanvasStore.getState().addNode(node("b"));
  const removing = removeSavedHarness("h1");
  await vi.advanceTimersByTimeAsync(1500);
  d.resolve(new Response(null, { status: 204 }));
  await removing;
  await vi.advanceTimersByTimeAsync(2000);
  expect(h.update).not.toHaveBeenCalled();
  expect(h.create).not.toHaveBeenCalled();
});

it("a delete that fails on the network keeps and saves the pending edits", async () => {
  openSaved("h1", "Mine");
  h.delete.mockRejectedValueOnce(new Error("network"));
  useCanvasStore.getState().addNode(node("b"));
  await expect(removeSavedHarness("h1")).rejects.toThrow();
  await vi.advanceTimersByTimeAsync(1000);
  expect(h.update).toHaveBeenCalledWith("h1", expect.anything());
});

it("opening a harness waits for every queued save, not only the first", async () => {
  const d = deferred<{ id: string; name: string }>();
  openSaved("h1", "S1");
  h.update.mockReturnValueOnce(d.p);
  await edit(() => useCanvasStore.getState().setHarnessMeta({ name: "S2" }));
  useCanvasStore.getState().setHarnessMeta({ name: "S3" });
  h.get.mockImplementation(async () => ({ id: "h1", name: h.update.mock.calls.at(-1)![1].name!, description: "", created_at: "", updated_at: "", graph_json: { nodes: [], edges: [] } }));
  const opening = openSavedHarness("h1");
  d.resolve({ id: "h1", name: "S2" });
  await vi.advanceTimersByTimeAsync(1000);
  await opening;
  expect(h.update.mock.calls.at(-1)![1].name).toBe("S3");
  expect(useCanvasStore.getState().harnessMeta.name).toBe("S3");
});

it("a failed save retries on its own while edits are pending", async () => {
  h.create.mockRejectedValueOnce(new Error("offline"));
  await edit(() => useCanvasStore.getState().addNode(node("a")));
  expect(useStudioDocsStore.getState().saveState).toBe("error");
  await vi.advanceTimersByTimeAsync(6000);
  expect(h.create).toHaveBeenCalledTimes(2);
  expect(useStudioDocsStore.getState().saveState).toBe("saved");
});

it("an import is saved right away as a new harness, never over the open one", async () => {
  openSaved("h1", "Mine");
  replaceStudioCanvas(() => {
    useCanvasStore.getState().loadGraph([node("imp")], []);
    useCanvasStore.getState().setHarnessMeta({ id: null, name: "Imported", description: "" });
  }, { saveNow: true });
  await vi.advanceTimersByTimeAsync(1000);
  expect(h.update).not.toHaveBeenCalled();
  expect(h.create).toHaveBeenCalledOnce();
  expect(h.create.mock.calls[0][0]).toBe("Imported");
});

// ── QA re-gate (PR #37) ────────────────────────────────────────────────────
it("deleting the open harness waits for an in-flight save before deleting", async () => {
  const d = deferred<{ id: string; name: string }>();
  openSaved("h1", "Mine");
  h.update.mockReturnValueOnce(d.p);
  await edit(() => useCanvasStore.getState().setHarnessMeta({ name: "Mine 2" }));
  expect(h.update).toHaveBeenCalledOnce();
  const removing = removeSavedHarness("h1");
  await vi.advanceTimersByTimeAsync(10);
  expect(h.delete).not.toHaveBeenCalled();
  d.resolve({ id: "h1", name: "Mine 2" });
  await removing;
  expect(h.delete).toHaveBeenCalledWith("h1");
});

it("a stale retry never overwrites a newer save of the same harness", async () => {
  // S1 fails; S2 (newer) is queued by a canvas swap and still in flight when
  // the retry fires — the retry must not re-send S1 after S2.
  openSaved("h1", "S0");
  h.update.mockRejectedValueOnce(new Error("offline"));
  await edit(() => useCanvasStore.getState().setHarnessMeta({ name: "S1" }));
  expect(useStudioDocsStore.getState().saveState).toBe("error");
  const d = deferred<{ id: string; name: string }>();
  h.update.mockReturnValueOnce(d.p);
  useCanvasStore.getState().setHarnessMeta({ name: "S2" });
  replaceStudioCanvas(() => useCanvasStore.getState().loadGraph([], []));
  await vi.advanceTimersByTimeAsync(6000);
  d.resolve({ id: "h1", name: "S2" });
  await vi.advanceTimersByTimeAsync(6000);
  expect(h.update.mock.calls.at(-1)![1].name).toBe("S2");
});

it("deleting a record stops retries of its failed saves", async () => {
  openSaved("h1", "Mine");
  h.update.mockRejectedValue(new Error("offline"));
  await edit(() => useCanvasStore.getState().setHarnessMeta({ name: "Mine 2" }));
  replaceStudioCanvas(() => useCanvasStore.getState().loadGraph([], []));
  await removeSavedHarness("h1");
  h.update.mockClear();
  await vi.advanceTimersByTimeAsync(20000);
  expect(h.update).not.toHaveBeenCalled();
});

it("replacing the canvas during a run is refused and keeps the session", async () => {
  openSaved("h1", "Mine");
  useCanvasStore.setState({ isRunning: true });
  replaceStudioCanvas(() => useCanvasStore.getState().setHarnessMeta({ id: null, name: "Other", description: "" }));
  expect(useCanvasStore.getState().harnessMeta.name).toBe("Mine");
});
