/**
 * Studio Copilot wire contract (spec §4–§5). Mirrors the backend models in
 * `backend/studio_copilot/`; the frozen golden cases keep both validators in
 * step.
 */
import type { NodeData } from "../types";
import type { CatalogType } from "./catalog";

export type { CatalogType };

/** Descriptive fields a copilot may read or write. Nothing else leaves the browser. */
export type CopilotConfig = Partial<
  Pick<NodeData, "roleId" | "skillId" | "gateId" | "systemPrompt" | "checklist" | "emits" | "consumes" | "approvalLabel">
>;

export interface CopilotNode {
  id: string;
  /** `decision` nodes are sent so the model knows they exist; ops cannot create or wire them. */
  type: CatalogType | "decision";
  label: string;
  config: CopilotConfig;
}

export interface CopilotEdge {
  source: string;
  sourceHandle: string;
  target: string;
  targetHandle: string;
}

export interface CopilotGraph {
  nodes: CopilotNode[];
  edges: CopilotEdge[];
}

export type Op =
  | { op: "addNode"; ref: string; type: CatalogType; label: string; config?: CopilotConfig; near?: string }
  | { op: "updateNode"; id: string; label?: string; config?: CopilotConfig }
  | { op: "removeNode"; id: string }
  | { op: "connect"; from: string; fromPort?: string; to: string; toPort?: string }
  | { op: "disconnect"; from: string; fromPort?: string; to: string; toPort?: string };

export type CopilotErrorCode =
  | "unknown_op"
  | "field_invalid"
  | "field_not_editable"
  | "bad_ref"
  | "unknown_type"
  | "unknown_node"
  | "empty_update"
  | "self_loop"
  | "bad_port"
  | "no_input_port"
  | "duplicate_edge"
  | "edge_not_found"
  | "graph_limit"
  | "too_many_ops";

export interface OpError {
  index: number;
  code: CopilotErrorCode;
  message: string;
}

export type ValidationResult = { ok: true; graph: CopilotGraph } | { ok: false; errors: OpError[] };

export interface CopilotPlan {
  summary: string;
  ops: Op[];
}

export type RequestMode = "mock" | "live" | "local";

export interface HistoryTurn {
  role: "user" | "assistant";
  text: string;
}

export interface PlanRequest {
  message: string;
  history: HistoryTurn[];
  graph: CopilotGraph;
  mode: RequestMode;
  connection_id?: string | null;
}

export interface PlanResponse extends CopilotPlan {
  source: "model" | "offline";
  tokens: number;
}

export type AssistField = "systemPrompt" | "checklist";
export type AssistAction = "draft" | "improve" | "review";

export interface AssistNeighbour {
  direction: "in" | "out";
  type: string;
  label: string;
  port: string;
}

export interface AssistRequest {
  field: AssistField;
  action: AssistAction;
  node: { type: string; label: string; roleId?: string; skillId?: string; gateId?: string };
  current?: string;
  intent?: string;
  focus?: string;
  neighbours?: AssistNeighbour[];
  harnessName?: string;
  mode: RequestMode;
  connection_id?: string | null;
}

export interface AssistResponse {
  /** `null` for review. */
  text: string | null;
  notes: string[];
  source: "model" | "offline";
  tokens: number;
}

export interface ApiErrorBody {
  error: string;
  detail?: string;
  errors?: { index: number; code: string; message: string }[];
}
