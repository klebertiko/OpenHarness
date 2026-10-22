"use client";
import { create } from "zustand";
import {
  applyNodeChanges,
  applyEdgeChanges,
  type NodeChange,
  type EdgeChange,
  type Connection,
} from "@xyflow/react";
import type { HarnessNode, HarnessEdge, NodeData, ExecutionMode } from "@/lib/types";
import { edgeForConnection, sameWire } from "@/lib/edges";
import { layoutGraph } from "@/lib/graphLayout";

/*
 * NOTE (shell workstream): this file arrived syntactically broken — the
 * interface had two malformed signatures and the implementation was truncated
 * mid-expression, so the frontend would not compile at all. It has been
 * repaired to the API its existing consumers already call. No behaviour was
 * redesigned; the graph/canvas workstream owns anything beyond this.
 */

interface HistoryEntry {
  nodes: HarnessNode[];
  edges: HarnessEdge[];
  /** Monotonic id. Indices shift once the 50-entry trim kicks in, so anything
   *  that needs to recognise "the entry I just pushed" (a Copilot proposal's
   *  Undo) keys on this instead. */
  seq: number;
}

const MAX_HISTORY = 50;

/** A HITL node parked mid-run, waiting on a person to approve or reject it. */
export interface AwaitingHuman {
  nodeId: string;
  question: string;
  context: string;
}

export interface CanvasState {
  nodes: HarnessNode[];
  edges: HarnessEdge[];
  selectedNodeId: string | null;
  executionMode: ExecutionMode;
  isRunning: boolean;
  harnessMeta: { id: string | null; name: string; description: string };
  /** Set on `hitl_pause`, cleared on `hitl_resolved` / `resetExecution`. Drives
   *  the approve/reject controls on the paused node's plate. */
  awaitingHuman: AwaitingHuman | null;

  _history: HistoryEntry[];
  _historyIndex: number;
  _seq: number;
  /** Bumped by `arrangeGraph`; the canvas watches it to re-frame the view. */
  fitSeq: number;

  setNodes: (nodes: HarnessNode[]) => void;
  setEdges: (edges: HarnessEdge[]) => void;
  onNodesChange: (changes: NodeChange[]) => void;
  onEdgesChange: (changes: EdgeChange[]) => void;
  onConnect: (connection: Connection) => void;

  addNode: (node: HarnessNode) => void;
  updateNodeData: (nodeId: string, data: Partial<NodeData>) => void;
  deleteSelected: () => void;
  /* Per-node verbs, driven by the hover toolbar on the plate. */
  removeNode: (nodeId: string) => void;
  duplicateNode: (nodeId: string) => void;
  detachNode: (nodeId: string) => void;

  pushHistory: () => void;
  /** Push a snapshot only if the live graph differs from the history head, so
   *  unrecorded edits (Inspector typing, drags) survive a later undo. */
  checkpoint: () => void;
  /** Apply a whole graph as exactly one undo step. Returns the new head `seq`,
   *  or `null` while a run owns the graph. */
  applyGraphPatch: (nodes: HarnessNode[], edges: HarnessEdge[]) => number | null;
  /** `updateNodeData` as one undo step. No-op while running. */
  commitNodeData: (nodeId: string, patch: Partial<NodeData>) => void;
  /** Layered auto-layout (ADR 0007) as exactly one undo step. Only positions
   *  change. Returns false when nothing moved: fewer than two nodes, a run owns
   *  the graph, or the graph is already laid out. */
  arrangeGraph: () => boolean;
  headSeq: () => number;
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;

  setSelectedNode: (id: string | null) => void;
  setExecutionMode: (mode: ExecutionMode) => void;
  setRunning: (v: boolean) => void;
  setHarnessMeta: (
    meta: Partial<{ id: string | null; name: string; description: string }>
  ) => void;

  setNodeStatus: (nodeId: string, status: NonNullable<NodeData["status"]>) => void;
  appendNodeOutput: (nodeId: string, chunk: string) => void;
  setNodeResult: (nodeId: string, output: string, tokens: number, latencyMs: number) => void;
  setNodeError: (nodeId: string, error: string) => void;
  setAwaitingHuman: (info: AwaitingHuman | null) => void;
  resetExecution: () => void;

  loadGraph: (nodes: HarnessNode[], edges: HarnessEdge[]) => void;
}

const snapshot = (s: Pick<CanvasState, "nodes" | "edges">, seq: number): HistoryEntry => ({
  nodes: s.nodes.map((n) => ({ ...n, data: { ...n.data } })),
  edges: s.edges.map((e) => ({ ...e })),
  seq,
});

export const useCanvasStore = create<CanvasState>((set, get) => ({
  nodes: [],
  edges: [],
  selectedNodeId: null,
  executionMode: "mock",
  isRunning: false,
  harnessMeta: { id: null, name: "Untitled Harness", description: "" },
  awaitingHuman: null,

  _history: [],
  _historyIndex: -1,
  _seq: 0,
  fitSeq: 0,

  pushHistory: () => {
    const { _history, _historyIndex, _seq } = get();
    const seq = _seq + 1;
    const next = [..._history.slice(0, _historyIndex + 1), snapshot(get(), seq)];
    const trimmed = next.length > MAX_HISTORY ? next.slice(next.length - MAX_HISTORY) : next;
    set({ _history: trimmed, _historyIndex: trimmed.length - 1, _seq: seq });
  },

  headSeq: () => get()._history[get()._historyIndex]?.seq ?? -1,

  checkpoint: () => {
    const { _history, _historyIndex, nodes, edges } = get();
    const head = _history[_historyIndex];
    if (head && JSON.stringify({ nodes, edges }) === JSON.stringify({ nodes: head.nodes, edges: head.edges })) return;
    get().pushHistory();
  },

  applyGraphPatch: (nodes, edges) => {
    if (get().isRunning) return null;
    get().checkpoint();
    set({ nodes, edges: edges.map((e) => ({ ...e, type: "harness" })) });
    get().pushHistory();
    return get().headSeq();
  },

  arrangeGraph: () => {
    const { nodes, edges, isRunning } = get();
    if (isRunning || nodes.length < 2) return false;
    const positions = layoutGraph(
      nodes.map((n) => {
        // React Flow adds the rendered size to the node; the typed shape omits it.
        const v = n as HarnessNode & { measured?: { width?: number; height?: number }; width?: number; height?: number };
        return { id: n.id, width: v.measured?.width ?? v.width, height: v.measured?.height ?? v.height };
      }),
      edges
    );
    const moved = nodes.map((n) => ({ ...n, position: positions[n.id] ?? n.position }));
    const changed = moved.some((n, i) => n.position.x !== nodes[i].position.x || n.position.y !== nodes[i].position.y);
    if (!changed) {
      // Already tidy: still re-frame, so the button always does something visible.
      set({ fitSeq: get().fitSeq + 1 });
      return false;
    }
    if (get().applyGraphPatch(moved, edges) === null) return false;
    set({ fitSeq: get().fitSeq + 1 });
    return true;
  },

  commitNodeData: (nodeId, patch) => {
    if (get().isRunning) return;
    get().checkpoint();
    get().updateNodeData(nodeId, patch);
    get().pushHistory();
  },

  undo: () => {
    if (get().isRunning) return;
    const { _history, _historyIndex } = get();
    if (_historyIndex <= 0) return;
    const entry = _history[_historyIndex - 1];
    set({ nodes: entry.nodes, edges: entry.edges, _historyIndex: _historyIndex - 1 });
  },

  redo: () => {
    if (get().isRunning) return;
    const { _history, _historyIndex } = get();
    if (_historyIndex >= _history.length - 1) return;
    const entry = _history[_historyIndex + 1];
    set({ nodes: entry.nodes, edges: entry.edges, _historyIndex: _historyIndex + 1 });
  },

  canUndo: () => get()._historyIndex > 0,
  canRedo: () => get()._historyIndex < get()._history.length - 1,

  setNodes: (nodes) => {
    set({ nodes });
    get().pushHistory();
  },
  setEdges: (edges) => {
    set({ edges });
    get().pushHistory();
  },

  // Change streams are high-frequency (every drag frame), so they do NOT push
  // history — only the discrete verbs below do.
  onNodesChange: (changes) =>
    set({ nodes: applyNodeChanges(changes, get().nodes as never) as unknown as HarnessNode[] }),
  onEdgesChange: (changes) =>
    set({ edges: applyEdgeChanges(changes, get().edges as never) as unknown as HarnessEdge[] }),

  /* A new wire inherits its meaning from the port it leaves (see
     lib/edges.ts, shared with Copilot ops). */
  onConnect: (connection) => {
    const source = get().nodes.find((n) => n.id === connection.source);
    const edge = edgeForConnection(source, connection);
    if (get().edges.some((e) => sameWire(e, edge, get().nodes))) return;
    set({ edges: [...get().edges, edge] });
    get().pushHistory();
  },

  addNode: (node) => {
    set({ nodes: [...get().nodes, node] });
    get().pushHistory();
  },

  updateNodeData: (nodeId, data) => {
    if (get().isRunning) return;
    get().resetExecution();
    set({
      nodes: get().nodes.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, ...data } } : n)),
    });
  },

  deleteSelected: () => {
    const id = get().selectedNodeId;
    if (!id) return;
    set({
      nodes: get().nodes.filter((n) => n.id !== id),
      edges: get().edges.filter((e) => e.source !== id && e.target !== id),
      selectedNodeId: null,
    });
    get().pushHistory();
  },

  removeNode: (nodeId) => {
    set({
      nodes: get().nodes.filter((n) => n.id !== nodeId),
      edges: get().edges.filter((e) => e.source !== nodeId && e.target !== nodeId),
      selectedNodeId: get().selectedNodeId === nodeId ? null : get().selectedNodeId,
    });
    get().pushHistory();
  },

  /* Offset by half a column so the copy is obviously a copy and not a node
     that failed to move. */
  duplicateNode: (nodeId) => {
    const src = get().nodes.find((n) => n.id === nodeId);
    if (!src) return;
    const copy: HarnessNode = {
      ...src,
      id: `${src.type}-${Date.now()}`,
      position: { x: src.position.x + 44, y: src.position.y + 44 },
      data: { ...src.data, status: "idle", output: undefined, error: undefined },
    };
    set({ nodes: [...get().nodes, copy], selectedNodeId: copy.id });
    get().pushHistory();
  },

  detachNode: (nodeId) => {
    set({ edges: get().edges.filter((e) => e.source !== nodeId && e.target !== nodeId) });
    get().pushHistory();
  },

  setSelectedNode: (selectedNodeId) => set({ selectedNodeId }),
  setExecutionMode: (executionMode) => {
    if (get().isRunning || get().executionMode === executionMode) return;
    get().resetExecution();
    set({ executionMode });
  },
  setRunning: (isRunning) => set({ isRunning }),
  setHarnessMeta: (meta) => set({ harnessMeta: { ...get().harnessMeta, ...meta } }),

  setNodeStatus: (nodeId, status) =>
    set({
      nodes: get().nodes.map((n) =>
        n.id === nodeId ? { ...n, data: { ...n.data, status, error: undefined } } : n
      ),
    }),

  appendNodeOutput: (nodeId, chunk) =>
    set({
      nodes: get().nodes.map((n) =>
        n.id === nodeId ? { ...n, data: { ...n.data, output: (n.data.output ?? "") + chunk } } : n
      ),
    }),

  setNodeResult: (nodeId, output, tokens, latencyMs) =>
    set({
      nodes: get().nodes.map((n) =>
        n.id === nodeId
          ? { ...n, data: { ...n.data, status: "complete", output, tokens, latencyMs } }
          : n
      ),
    }),

  setNodeError: (nodeId, error) =>
    set({
      nodes: get().nodes.map((n) =>
        n.id === nodeId ? { ...n, data: { ...n.data, status: "error", error } } : n
      ),
    }),

  setAwaitingHuman: (awaitingHuman) => set({ awaitingHuman }),

  resetExecution: () =>
    set({
      nodes: get().nodes.map((n) => ({
        ...n,
        data: {
          ...n.data,
          status: "idle" as const,
          output: undefined,
          error: undefined,
          tokens: undefined,
          latencyMs: undefined,
        },
      })),
      awaitingHuman: null,
    }),

  /* Every edge is a harness wire. Presets and imported JSON are normalised on
     the way in so no code path can ever produce a default bezier. */
  loadGraph: (nodes, edges) => {
    if (get().isRunning) return;
    set({ _history: [], _historyIndex: -1, awaitingHuman: null });
    set({
      nodes,
      edges: edges.map((e) => ({ ...e, type: "harness" })),
      selectedNodeId: null,
    });
    get().pushHistory();
  },
}));
