import type { NodeType } from "@/lib/types";

/** One tool invocation, from call to result. */
export interface ToolCall {
  callId: string;
  name: string;
  args: string;
  ok?: boolean;
  result?: string;
  durationMs?: number;
}

/**
 * A run of contiguous same-kind output inside one node.
 *
 * Streamed text is coalesced into the trailing block rather than appended as
 * one element per token — a 900-token answer is one paragraph to a reader, and
 * 900 DOM nodes to a browser.
 */
export type Block =
  | { kind: "reason"; text: string }
  | { kind: "text"; text: string }
  | { kind: "tool"; call: ToolCall };

export type SegmentState = "pending" | "running" | "gate" | "done" | "error" | "skipped";

export type Phase = "thinking" | "tool" | "writing" | "routing" | "";

export interface Segment {
  nodeId: string;
  type: NodeType;
  label: string;
  adapter: string;
  model: string;
  intrinsic: boolean;

  state: SegmentState;
  phase: Phase;
  phaseDetail: string;

  blocks: Block[];
  output?: string;
  tokens?: number;
  latencyMs?: number;
  error?: string;

  gate?: {
    question: string;
    context: string;
    decision?: "approve" | "reject";
    note?: string;
  };

  startedAt?: number;
  endedAt?: number;
}

export type RunStatus =
  | "idle"
  | "starting"
  | "running"
  | "gate"
  | "paused"
  | "stopped"
  | "complete"
  | "error";

export interface RunState {
  runId: string | null;
  status: RunStatus;
  mode: string;
  step: boolean;
  plan: Segment[];
  cursor: number;
  totals: { tokens: number; nodesRun: number; elapsedMs: number };
  startedAt: number | null;
  endedAt: number | null;
  /** Node the engine is parked before, in step mode. */
  awaitingStep: { nodeId: string; label: string; type: NodeType } | null;
  /** Operator instructions injected while the run was already moving. */
  steers: { text: string; atNode: string }[];
  notices: string[];
}

export interface RunEvent {
  event: string;
  data: Record<string, unknown>;
}
