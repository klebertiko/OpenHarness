import type { HarnessEdge, HarnessGraph, HarnessNode, NodeType } from "@/lib/types";

const OHM_TYPES = new Set<NodeType>(["agent", "gate", "hitl", "skill", "mcp", "tool"]);

const LEGACY_TYPE_MAP: Record<string, NodeType> = {
  input: "agent",
  output: "agent",
  llm: "agent",
  evaluator: "gate",
  router: "gate",
  memory: "skill",
  aggregator: "agent",
  hitl: "hitl",
  tool: "tool",
  mcp: "mcp",
  agent: "agent",
  gate: "gate",
  skill: "skill",
};

function resolveType(raw: unknown, role?: unknown): NodeType {
  if (typeof raw === "string" && OHM_TYPES.has(raw as NodeType)) return raw as NodeType;
  if (typeof raw === "string" && Object.hasOwn(LEGACY_TYPE_MAP, raw)) return LEGACY_TYPE_MAP[raw];
  // Bundle default-agile nodes are { id, role, label } with no type.
  if (typeof role === "string" && role.length > 0) return "agent";
  return "agent";
}

/** Restore authored graphs without injecting execution prompts or providers. */
export function bundleGraphToCanvas(
  graph: { nodes?: unknown[]; edges?: unknown[] } | null | undefined
): HarnessGraph {
  const nodes: HarnessNode[] = (Array.isArray(graph?.nodes) ? graph.nodes : [])
    .filter((n): n is Record<string, unknown> => !!n && typeof n === "object" && "id" in n)
    .map((n, index) => {
      const existingData = n.data && typeof n.data === "object" ? n.data as Record<string, unknown> : {};
      const data: HarnessNode["data"] = {
        ...existingData,
        label: String(existingData.label ?? n.label ?? n.role ?? n.id),
        ...(n.type == null && typeof n.role === "string" && existingData.roleId == null ? { roleId: n.role } : {}),
      };
      delete data.apiKey;
      const position = n.position && typeof n.position === "object"
        ? n.position as HarnessNode["position"]
        : { x: 80 + (index % 4) * 180, y: 80 + Math.floor(index / 4) * 100 };
      return {
        ...n,
        id: String(n.id),
        type: resolveType(n.type, n.role),
        position,
        data,
      };
    });
  const edges: HarnessEdge[] = (Array.isArray(graph?.edges) ? graph.edges : [])
    .filter((e): e is Record<string, unknown> => !!e && typeof e === "object" && "source" in e && "target" in e)
    .map((e, index) => ({ ...e, id: String(e.id ?? `e-${index}`), source: String(e.source), target: String(e.target) }));
  return { nodes, edges };
}

/**
 * Bundle graphs from `/bundles/default` use `{ id, role, label }`. The execution
 * engine expects xyflow-shaped nodes with `type` + `data`. Normalize at the
 * Agent start seam so either shape can run.
 *
 * `fallbackProviderId` is the chat composer's currently-selected connection
 * (see `backend/providers/resolution.py`'s precedence docstring: node pin
 * wins, otherwise the chip's choice fills `providerIds[0]`, otherwise the
 * backend raises an honest error — it never re-derives a fallback of its
 * own). A node that already carries its own non-empty `providerIds` (an
 * author's deliberate pin) is left untouched. `adapter` is no longer forced
 * to `"mock"` here — a node with no real provider and no fallback simply
 * carries no adapter, and the engine's own resolution path is what decides
 * what that means (an honest error in live/local mode, MockAdapter only in
 * explicit mock mode).
 */
export function bundleGraphToEngine(
  graph: { nodes?: unknown[]; edges?: unknown[] } | null | undefined,
  instruction?: string,
  fallbackProviderId?: string
): HarnessGraph {
  const rawNodes = Array.isArray(graph?.nodes) ? graph!.nodes : [];
  const rawEdges = Array.isArray(graph?.edges) ? graph!.edges : [];

  const nodes: HarnessNode[] = rawNodes
    .filter((n): n is Record<string, unknown> => !!n && typeof n === "object" && "id" in n)
    .map((n, index) => {
      const id = String(n.id);
      const existingData =
        n.data && typeof n.data === "object" ? (n.data as Record<string, unknown>) : {};
      const role = n.role ?? existingData.roleId;
      const label = String(existingData.label ?? n.label ?? role ?? id);
      const type = resolveType(n.type, role);
      const position =
        n.position && typeof n.position === "object"
          ? (n.position as { x: number; y: number })
          : { x: 80 + (index % 4) * 180, y: 80 + Math.floor(index / 4) * 100 };

      const ownProviderIds = Array.isArray(existingData.providerIds)
        ? (existingData.providerIds as unknown[]).filter((p): p is string => typeof p === "string")
        : [];
      const hasOwnProviderIds = ownProviderIds.length > 0 && Boolean(ownProviderIds[0]);
      const providerIds = hasOwnProviderIds
        ? ownProviderIds
        : fallbackProviderId
          ? [fallbackProviderId]
          : [];

      const data = {
        ...existingData,
        label,
        roleId: String(existingData.roleId ?? role ?? ""),
        providerIds,
        ...(existingData.adapter ? { adapter: String(existingData.adapter) } : {}),
        ...(index === 0 && instruction ? { prompt: instruction } : {}),
      } as HarnessNode["data"];

      return { id, type, position, data };
    });

  const edges: HarnessEdge[] = rawEdges
    .filter(
      (e): e is Record<string, unknown> =>
        !!e && typeof e === "object" && "source" in e && "target" in e
    )
    .map((e, i) => {
      const edgeData =
        e.data && typeof e.data === "object" ? (e.data as Record<string, unknown>) : {};
      return {
        id: String(e.id ?? `e-${i}`),
        source: String(e.source),
        target: String(e.target),
        sourceHandle: (e.sourceHandle as string | null | undefined) ?? null,
        targetHandle: (e.targetHandle as string | null | undefined) ?? null,
        data: {
          ...edgeData,
          signal: typeof edgeData.signal === "string" ? edgeData.signal : undefined,
          kind: edgeData.kind as HarnessEdge["data"] extends { kind?: infer K } ? K : undefined,
        },
      };
    });

  return { nodes, edges };
}
