import dagre from "@dagrejs/dagre";

/**
 * Layered auto-layout for the Studio canvas (ADR 0007).
 *
 * A pure seam: ids and sizes in, top-left positions out. It knows nothing about
 * React Flow, the store or the OHM format, so the canvas button, the command
 * palette and the example-fixture generator all share one implementation.
 */

/** Width of a node plate on the canvas (BaseNode PLATE_W). */
export const NODE_W = 212;
/** Height used for a node nobody has measured yet. Generous on purpose: an
 *  over-estimate only adds air, an under-estimate overlaps. */
export const NODE_H = 120;

export interface LayoutNode {
  id: string;
  width?: number;
  height?: number;
}

export interface LayoutEdge {
  source: string;
  target: string;
}

export interface LayoutOptions {
  /** `LR` puts the first layer on the left, `TB` on top. Default `LR`. */
  direction?: "LR" | "TB";
  /** Gap between nodes of the same layer, in px. */
  nodeGap?: number;
  /** Gap between layers, in px. */
  layerGap?: number;
}

export type LayoutPositions = Record<string, { x: number; y: number }>;

/**
 * Assign every node a position so that layers follow edge direction and no two
 * boxes overlap. Edges to unknown ids and self loops are ignored; cycles are
 * broken internally (their back edges still render, they just point backwards).
 * The result depends only on the input order, never on time or randomness.
 */
export function layoutGraph(
  nodes: LayoutNode[],
  edges: LayoutEdge[],
  opts: LayoutOptions = {}
): LayoutPositions {
  const { direction = "LR", nodeGap = 48, layerGap = 96 } = opts;
  const g = new dagre.graphlib.Graph({ multigraph: false });
  g.setGraph({
    rankdir: direction,
    nodesep: nodeGap,
    ranksep: layerGap,
    marginx: 0,
    marginy: 0,
    acyclicer: "greedy",
    ranker: "network-simplex",
  });
  g.setDefaultEdgeLabel(() => ({}));

  const size = new Map<string, { w: number; h: number }>();
  for (const n of nodes) {
    if (size.has(n.id)) continue;
    const w = Math.max(1, n.width ?? NODE_W);
    const h = Math.max(1, n.height ?? NODE_H);
    size.set(n.id, { w, h });
    g.setNode(n.id, { width: w, height: h });
  }
  const seen = new Set<string>();
  for (const e of edges) {
    if (e.source === e.target || !size.has(e.source) || !size.has(e.target)) continue;
    const key = `${e.source}\u0000${e.target}`;
    if (seen.has(key)) continue;
    seen.add(key);
    g.setEdge(e.source, e.target);
  }

  dagre.layout(g);

  const out: LayoutPositions = {};
  for (const [id, { w, h }] of size) {
    const p = g.node(id);
    // dagre reports centres; the canvas wants the top-left corner.
    out[id] = { x: Math.round(p.x - w / 2), y: Math.round(p.y - h / 2) };
  }
  return out;
}
