import { beforeEach, expect, it } from "vitest";
import { useCanvasStore } from "./canvasStore";
const node = { id: "a", type: "agent" as const, position: { x: 0, y: 0 }, data: { label: "Agent", providerIds: ["a"] } };
beforeEach(() => { useCanvasStore.setState({ isRunning: false, _history: [], _historyIndex: -1 }); useCanvasStore.getState().loadGraph([structuredClone(node)], []); });
it("a new imported harness starts a separate undo history", () => {
  const s = useCanvasStore.getState(); s.addNode({ ...node, id: "b" });
  s.loadGraph([{ ...node, id: "other-bundle" }], []); s.undo();
  expect(useCanvasStore.getState().nodes.map(n => n.id)).toEqual(["other-bundle"]);
  expect(useCanvasStore.getState().canUndo()).toBe(false);
});
it("edits and mode changes clear old run residue", () => {
  const s=useCanvasStore.getState(); s.setNodeError("a", "Old failure");
  s.updateNodeData("a", { providerIds: ["fixed"] });
  expect(useCanvasStore.getState().nodes[0].data.error).toBeUndefined();
  expect(useCanvasStore.getState().nodes[0].data.status).toBe("idle");
  s.setNodeResult("a", "Old output", 3, 10); s.setExecutionMode("live");
  expect(useCanvasStore.getState().nodes[0].data.output).toBeUndefined();
});
it("cannot replace or undo the graph while a run owns it", () => {
  const s=useCanvasStore.getState(); s.addNode({ ...node, id: "b" }); s.setRunning(true);
  const before=useCanvasStore.getState().nodes; s.loadGraph([], []); s.undo(); s.redo();
  expect(useCanvasStore.getState().nodes).toBe(before);
});
