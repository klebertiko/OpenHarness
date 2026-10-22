import { describe, expect, it } from "vitest";
import { layoutGraph, NODE_W, type LayoutEdge, type LayoutNode } from "./graphLayout";

const box = (id: string, p: { x: number; y: number }, n?: LayoutNode) => ({
  id,
  x: p.x,
  y: p.y,
  w: n?.width ?? NODE_W,
  h: n?.height ?? 100,
});

function overlaps(nodes: LayoutNode[], pos: Record<string, { x: number; y: number }>) {
  const boxes = nodes.map((n) => box(n.id, pos[n.id], n));
  const hits: string[] = [];
  for (let i = 0; i < boxes.length; i++)
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], b = boxes[j];
      if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) hits.push(`${a.id}~${b.id}`);
    }
  return hits;
}

const ids = (...xs: string[]): LayoutNode[] => xs.map((id) => ({ id, height: 100 }));
const e = (source: string, target: string): LayoutEdge => ({ source, target });

describe("layoutGraph", () => {
  it("returns an empty map for an empty graph", () => {
    expect(layoutGraph([], [])).toEqual({});
  });

  it("places every node, with finite integer coordinates", () => {
    const nodes = ids("a", "b", "c");
    const pos = layoutGraph(nodes, [e("a", "b"), e("b", "c")]);
    expect(Object.keys(pos).sort()).toEqual(["a", "b", "c"]);
    for (const p of Object.values(pos)) {
      expect(Number.isInteger(p.x)).toBe(true);
      expect(Number.isInteger(p.y)).toBe(true);
    }
  });

  it("never overlaps node boxes on a diamond with a long skip edge", () => {
    const nodes = ids("a", "b", "c", "d", "e");
    const edges = [e("a", "b"), e("a", "c"), e("b", "d"), e("c", "d"), e("d", "e"), e("a", "e")];
    expect(overlaps(nodes, layoutGraph(nodes, edges))).toEqual([]);
  });

  it("lays layers out left to right in edge direction", () => {
    const nodes = ids("a", "b", "c", "d");
    const edges = [e("a", "b"), e("a", "c"), e("b", "d"), e("c", "d")];
    const pos = layoutGraph(nodes, edges);
    for (const ed of edges) {
      expect(pos[ed.source].x + NODE_W).toBeLessThanOrEqual(pos[ed.target].x);
    }
  });

  it("lays layers out top to bottom when asked", () => {
    const nodes = ids("a", "b", "c");
    const edges = [e("a", "b"), e("b", "c")];
    const pos = layoutGraph(nodes, edges, { direction: "TB" });
    expect(pos.a.y).toBeLessThan(pos.b.y);
    expect(pos.b.y).toBeLessThan(pos.c.y);
    expect(overlaps(nodes, pos)).toEqual([]);
  });

  it("is deterministic for the same input", () => {
    const nodes = ids("a", "b", "c", "d", "e", "f");
    const edges = [e("a", "b"), e("a", "c"), e("c", "d"), e("b", "d"), e("e", "d")];
    expect(layoutGraph(nodes, edges)).toEqual(layoutGraph(nodes, edges));
    expect(layoutGraph(nodes, edges)).toEqual(layoutGraph(nodes.map((n) => ({ ...n })), edges.map((x) => ({ ...x }))));
  });

  it("keeps disconnected nodes and isolated components apart", () => {
    const nodes = ids("a", "b", "x", "y", "z");
    const pos = layoutGraph(nodes, [e("a", "b")]);
    expect(Object.keys(pos)).toHaveLength(5);
    expect(overlaps(nodes, pos)).toEqual([]);
  });

  it("does not crash on a graph with no edges at all", () => {
    const nodes = ids("a", "b", "c", "d");
    expect(overlaps(nodes, layoutGraph(nodes, []))).toEqual([]);
  });

  it("survives cycles, self loops and duplicate edges", () => {
    const nodes = ids("a", "b", "c");
    const edges = [e("a", "b"), e("b", "c"), e("c", "a"), e("b", "b"), e("a", "b")];
    const pos = layoutGraph(nodes, edges);
    expect(Object.keys(pos)).toHaveLength(3);
    for (const p of Object.values(pos)) {
      expect(Number.isFinite(p.x)).toBe(true);
      expect(Number.isFinite(p.y)).toBe(true);
    }
    expect(overlaps(nodes, pos)).toEqual([]);
  });

  it("ignores edges that point at nodes that do not exist", () => {
    const nodes = ids("a", "b");
    const pos = layoutGraph(nodes, [e("a", "b"), e("a", "ghost"), e("ghost", "b")]);
    expect(Object.keys(pos).sort()).toEqual(["a", "b"]);
  });

  it("uses each node's measured size, so a tall node does not collide", () => {
    const nodes: LayoutNode[] = [
      { id: "a", width: 212, height: 260 },
      { id: "b", width: 212, height: 90 },
      { id: "c", width: 340, height: 90 },
    ];
    const pos = layoutGraph(nodes, [e("a", "b"), e("a", "c")]);
    expect(overlaps(nodes, pos)).toEqual([]);
    expect(pos.a.x + 212).toBeLessThanOrEqual(Math.min(pos.b.x, pos.c.x));
  });

  it("stays overlap-free on a wide fan-out and fan-in", () => {
    const leaves = Array.from({ length: 20 }, (_, i) => `n${i}`);
    const nodes = ids("root", "sink", ...leaves);
    const edges = leaves.flatMap((l) => [e("root", l), e(l, "sink")]);
    expect(overlaps(nodes, layoutGraph(nodes, edges))).toEqual([]);
  });
});
