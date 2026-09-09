export type NodeType =
  | "input"
  | "output"
  | "llm"
  | "tool"
  | "evaluator"
  | "router"
  | "hitl"
  | "memory"
  | "aggregator";

export type AdapterType = "mock" | "ollama" | "openai" | "claude" | "lmstudio" | "codex";
export type ExecutionMode = "mock" | "live" | "local";

export interface NodeData {
  label: string;
  // input / output
  prompt?: string;
  // llm / evaluator / aggregator
  adapter?: AdapterType;
  model?: string;
  endpoint?: string;
  /** Opaque vault reference (e.g. `openharness/openai`). Never a raw key. */
  secretRef?: string;
  /** @deprecated POC field — do not persist; use `secretRef` instead. */
  apiKey?: string;
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
  // router
  condition?: string;
  // hitl
  approvalLabel?: string;
  // runtime (not persisted)
  status?: "idle" | "running" | "complete" | "error" | "paused";
  output?: string;
  tokens?: number;
  latencyMs?: number;
  error?: string;
  // xyflow requires index signature for node data
  [key: string]: unknown;
}

export interface HarnessNode {
  id: string;
  type: NodeType;
  position: { x: number; y: number };
  data: NodeData;
}

/**
 * What an edge *means*, not what it looks like. The renderer derives stroke,
 * dash and marker from this; nothing else in the app is allowed to style an
 * edge directly. Backward-running (feedback) geometry is detected from the
 * node positions at draw time, so moving a node can turn a forward edge into a
 * visible loop without anyone rewriting data.
 */
export type EdgeKind = "flow" | "accept" | "reject";

export interface EdgeData {
  kind?: EdgeKind;
  /** Port name shown on the wire, e.g. "pass", "reject", "else". */
  label?: string;
  [key: string]: unknown;
}

export interface HarnessEdge {
  id: string;
  type?: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
  animated?: boolean;
  data?: EdgeData;
}

export interface HarnessGraph {
  nodes: HarnessNode[];
  edges: HarnessEdge[];
}

export interface HarnessMeta {
  id: string;
  name: string;
  description: string;
  created_at: string;
  updated_at: string;
}

/** Palette grouping. Nine flat rows is a list; four stages is a mental model. */
export type NodeStage = "boundary" | "compute" | "control" | "state";

export interface NodeTemplate {
  type: NodeType;
  label: string;
  description: string;
  stage: NodeStage;
  defaultData: Partial<NodeData>;
  /** Legacy fields kept so older consumers keep type-checking. Unused: role
   *  identity now lives in lib/roles.ts and is derived from the node type. */
  icon?: string;
  color?: string;
}
