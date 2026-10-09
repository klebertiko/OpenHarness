import { beforeEach, describe, expect, it } from "vitest";
import { useCanvasStore } from "./canvasStore";
import type { HarnessEdge, HarnessNode } from "@/lib/types";

const node = (id: string, x = 0): HarnessNode => ({ id, type: "agent", position: { x, y: 0 }, data: { label: id, systemPrompt: "old" } });
const edge: HarnessEdge = { id: "e-a-out-b-in", type: "harness", source: "a", target: "b", sourceHandle: "out", targetHandle: "in", data: { kind: "flow" } };

const S = () => useCanvasStore.getState();
const ids = () => S().nodes.map((n) => n.id);

beforeEach(() => {
  useCanvasStore.setState({ isRunning: false, _history: [], _historyIndex: -1 });
  S().loadGraph([node("a"), node("b", 280)], [edge]);
});

describe("canvasStore — copilot patch API", () => {
  it("applyGraphPatch is one undo step and keeps an unrecorded Inspector edit", () => {
    S().updateNodeData("a", { systemPrompt: "edited" }); // pushes no history
    const patched = [...S().nodes, node("c", 560)];
    const seq = S().applyGraphPatch(patched, S().edges);
    expect(seq).not.toBeNull();
    expect(ids()).toEqual(["a", "b", "c"]);
    S().undo();
    expect(ids()).toEqual(["a", "b"]);
    expect(S().nodes.find((n) => n.id === "a")!.data.systemPrompt).toBe("edited");
  });

  it("returns the new head seq, which changes after any later history push", () => {
    const seq = S().applyGraphPatch([...S().nodes, node("c")], S().edges);
    expect(seq).toBe(S().headSeq());
    S().addNode(node("d"));
    expect(S().headSeq()).not.toBe(seq);
  });

  it("forces edges to the harness type", () => {
    S().applyGraphPatch(S().nodes, [{ ...edge, type: undefined }]);
    expect(S().edges[0].type).toBe("harness");
  });

  it("returns null and changes nothing while a run owns the graph", () => {
    S().setRunning(true);
    const before = S().nodes;
    expect(S().applyGraphPatch([], [])).toBeNull();
    expect(S().nodes).toBe(before);
  });

  it("commitNodeData is one undo step restoring the old field value", () => {
    S().commitNodeData("a", { systemPrompt: "new text" });
    expect(S().nodes[0].data.systemPrompt).toBe("new text");
    S().undo();
    expect(S().nodes[0].data.systemPrompt).toBe("old");
  });

  it("commitNodeData is a no-op while running", () => {
    S().setRunning(true);
    S().commitNodeData("a", { systemPrompt: "nope" });
    expect(S().nodes[0].data.systemPrompt).toBe("old");
  });

  it("checkpoint pushes only when the graph differs from the history head", () => {
    const seq = S().headSeq();
    S().checkpoint();
    expect(S().headSeq()).toBe(seq);
    S().updateNodeData("a", { systemPrompt: "dirty" });
    S().checkpoint();
    expect(S().headSeq()).not.toBe(seq);
  });

  it("a seq taken before the 50-entry trim no longer matches the head", () => {
    const seq = S().applyGraphPatch([...S().nodes, node("c")], S().edges);
    for (let i = 0; i < 60; i++) S().addNode(node(`n${i}`));
    expect(S()._historyIndex).toBe(49);
    expect(S().headSeq()).not.toBe(seq);
  });
});

describe("canvasStore — wires are deduplicated by what they connect, not by id (QA M3)", () => {
  it("dragging an existing wire again does nothing, even when it was saved under a legacy id", () => {
    S().loadGraph([node("a"), node("b", 280)], [{ id: "e-po-stl", source: "a", target: "b", type: "harness", data: { kind: "flow" } }]);
    S().onConnect({ source: "a", target: "b", sourceHandle: "out", targetHandle: "in" });
    S().onConnect({ source: "a", target: "b", sourceHandle: null, targetHandle: null });
    expect(S().edges).toHaveLength(1);
  });

  it("still adds a different port between the same two nodes", () => {
    S().loadGraph(
      [{ id: "g", type: "gate", position: { x: 0, y: 0 }, data: { label: "G" } }, node("b", 280)],
      [{ id: "legacy", source: "g", target: "b", sourceHandle: "pass", targetHandle: "in", type: "harness", data: { kind: "accept" } }],
    );
    S().onConnect({ source: "g", target: "b", sourceHandle: "fail", targetHandle: "in" });
    expect(S().edges).toHaveLength(2);
  });
});

describe("canvasStore — onConnect uses edgeForConnection", () => {
  it("decorates a gate fail wire and ignores a duplicate", () => {
    S().loadGraph([{ id: "g", type: "gate", position: { x: 0, y: 0 }, data: { label: "G" } }, node("b")], []);
    S().onConnect({ source: "g", target: "b", sourceHandle: "fail", targetHandle: "in" });
    S().onConnect({ source: "g", target: "b", sourceHandle: "fail", targetHandle: "in" });
    expect(S().edges).toHaveLength(1);
    expect(S().edges[0]).toMatchObject({ id: "e-g-fail-b-in", type: "harness", data: { kind: "reject", label: "fail" } });
  });
});
