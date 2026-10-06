import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useCanvasStore } from "@/store/canvasStore";
import { useShellStore } from "@/components/shell/shellStore";
import { api } from "./api";
import { importGraphFile } from "./actions";
import { openStudioPreset } from "./studio";
import { HARNESS_PRESETS } from "./templates";
import type { HarnessNode } from "./types";
import { flushAutosave, markClean, startAutosave } from "./studioDocuments";

// Every caller that swaps what is on the canvas must save the open harness's
// pending (not yet debounced) edits first — QA bounce on PR #37, item 4.

vi.mock("./api", () => ({
  api: { harnesses: { list: vi.fn(), get: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() } },
}));
const h = vi.mocked(api.harnesses);
const node = (id: string): HarnessNode => ({ id, type: "agent", position: { x: 0, y: 0 }, data: { label: id } } as HarnessNode);
let stop: (() => void) | null = null;

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  h.list.mockResolvedValue([]);
  h.create.mockResolvedValue({ id: "new", name: "x" });
  h.update.mockResolvedValue({ id: "h1", name: "x" });
  useShellStore.setState({ section: "studio", studioView: "editor" });
  useCanvasStore.setState({ isRunning: false, nodes: [node("a")], edges: [], harnessMeta: { id: "h1", name: "Mine", description: "" } });
  markClean();
  stop = startAutosave();
  // An edit still inside the 500 ms debounce window.
  useCanvasStore.getState().addNode(node("pending"));
});
afterEach(() => { stop?.(); vi.useRealTimers(); });

const oldHarnessSaved = () => {
  const put = h.update.mock.calls.find((c) => c[0] === "h1");
  expect(put, "the open harness's pending edit was not saved").toBeTruthy();
  expect(put![1].graph_json!.nodes.map((n) => n.id)).toEqual(["a", "pending"]);
};

it("opening a preset (palette, deep link, starting point) saves pending edits first", async () => {
  openStudioPreset(HARNESS_PRESETS.find((p) => p.id === "minimal-gate")!);
  await flushAutosave();
  oldHarnessSaved();
  expect(useCanvasStore.getState().harnessMeta.id).toBeNull();
  expect(h.create).not.toHaveBeenCalled();
});

it("importing graph JSON saves pending edits first, then saves the import as a new harness", async () => {
  expect(importGraphFile(JSON.stringify({ nodes: [node("imp")], edges: [] }), "Team flow.harness.json")).toBe(true);
  await flushAutosave();
  oldHarnessSaved();
  expect(h.create).toHaveBeenCalledOnce();
  expect(h.create.mock.calls[0][0]).toBe("Team flow");
  expect(useCanvasStore.getState().harnessMeta.id).toBe("new");
});

it("a malformed import changes nothing", async () => {
  expect(importGraphFile("{nope", "bad.json")).toBe(false);
  expect(useCanvasStore.getState().harnessMeta.id).toBe("h1");
});

it("an import with malformed nodes or edges is rejected without touching the canvas", () => {
  for (const text of [
    JSON.stringify({ nodes: [null], edges: [] }),
    JSON.stringify({ nodes: [1, "x"], edges: [] }),
    JSON.stringify({ nodes: [{ id: "a", type: "agent", position: { x: 0, y: 0 }, data: {} }], edges: [null] }),
    JSON.stringify({ nodes: [{ type: "agent" }], edges: [] }),
  ]) {
    expect(importGraphFile(text, "bad.json")).toBe(false);
  }
  expect(useCanvasStore.getState().harnessMeta.id).toBe("h1");
  expect(useCanvasStore.getState().nodes.map((n) => n.id)).toEqual(["a", "pending"]);
});
