import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useCanvasStore } from "@/store/canvasStore";
import { useShellStore } from "@/components/shell/shellStore";
import { api } from "./api";
import type { HarnessEdge, HarnessNode } from "./types";
import {
  flushAutosave, hasStudioDraft, markClean, openSavedHarness, removeSavedHarness, startAutosave,
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
