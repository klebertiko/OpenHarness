import type { HarnessEdge, HarnessGraph, HarnessNode, NodeType } from "@/lib/types";

/**
 * Bundle graphs from `/bundles/default` use `{ id, role, label }`. The execution
 * engine expects xyflow-shaped nodes with `type` + `data`. Normalize at the
 * Agent start seam so either shape can run.
 */
export function bundleGraphToEngine(
  graph: { nodes?: unknown[]; edges?: unknown[] } | null | undefined,
  instruction?: string
): HarnessGraph {
  const rawNodes = Array.isArray(graph?.nodes) ? graph!.nodes : [];
  const rawEdges = Array.isArray(graph?.edges) ? graph!.edges : [];

  const nodes: HarnessNode[] = rawNodes
    .filter((n): n is Record<string, unknown> => !!n && typeof n === "object" && "id" in n)
    .map((n, index) => {
      const id = String(n.id);
      const existingData =
        n.data && typeof n.data === "object" ? (n.data as Record<string, unknown>) : {};
      const label =
        String(existingData.label ?? n.label ?? n.role ?? id);
      const type = (typeof n.type === "string" ? n.type : "llm") as NodeType;
      const position =
        n.position && typeof n.position === "object"
          ? (n.position as { x: number; y: number })
          : { x: 80 + (index % 4) * 180, y: 80 + Math.floor(index / 4) * 100 };

      const data = {
        ...existingData,
        label,
        adapter: String(existingData.adapter ?? "mock"),
        ...(index === 0 && instruction
          ? { prompt: instruction }
          : {}),
      } as HarnessNode["data"];

      return { id, type, position, data };
    });

  const edges: HarnessEdge[] = rawEdges
    .filter(
      (e): e is Record<string, unknown> =>
        !!e && typeof e === "object" && "source" in e && "target" in e
    )
    .map((e, i) => ({
      id: String(e.id ?? `e-${i}`),
      source: String(e.source),
      target: String(e.target),
      sourceHandle: (e.sourceHandle as string | null | undefined) ?? null,
      targetHandle: (e.targetHandle as string | null | undefined) ?? null,
    }));

  return { nodes, edges };
}
