import type { NodeType } from "@/lib/types";
import type { Block, RunState, Segment, ToolCall } from "./types";

export const emptyRun: RunState = {
  runId: null,
  status: "idle",
  mode: "mock",
  step: false,
  plan: [],
  cursor: -1,
  totals: { tokens: 0, nodesRun: 0, elapsedMs: 0 },
  startedAt: null,
  endedAt: null,
  awaitingStep: null,
  steers: [],
  notices: [],
};

type Action =
  | { type: "reset"; mode: string; step: boolean }
  | { type: "sse"; event: string; data: Record<string, never> | Record<string, unknown> }
  | { type: "transport-error"; message: string };

function seg(view: Record<string, unknown>): Segment {
  return {
    nodeId: String(view.node_id),
    type: (view.type as NodeType) ?? "llm",
    label: String(view.label ?? view.type ?? "node"),
    adapter: String(view.adapter ?? ""),
    model: String(view.model ?? ""),
    intrinsic: Boolean(view.intrinsic),
    state: "pending",
    phase: "",
    phaseDetail: "",
    blocks: [],
  };
}

/** Replace one segment by id, leaving the rest referentially untouched. */
function patch(state: RunState, nodeId: string, fn: (s: Segment) => Segment): RunState {
  let hit = false;
  const plan = state.plan.map((s) => {
    if (s.nodeId !== nodeId) return s;
    hit = true;
    return fn(s);
  });
  if (!hit) return state;
  return { ...state, plan };
}

/**
 * Append streamed text to the trailing block when it is the same kind, so a
 * paragraph stays one block no matter how many chunks it arrived in.
 */
function appendText(blocks: Block[], kind: "reason" | "text", text: string): Block[] {
  const last = blocks[blocks.length - 1];
  if (last && last.kind === kind) {
    return [...blocks.slice(0, -1), { kind, text: last.text + text }];
  }
  return [...blocks, { kind, text }];
}

export function runReducer(state: RunState, action: Action): RunState {
  if (action.type === "reset") {
    return { ...emptyRun, mode: action.mode, step: action.step, status: "starting" };
  }
  if (action.type === "transport-error") {
    return {
      ...state,
      status: "error",
      endedAt: Date.now(),
      notices: [...state.notices, action.message],
    };
  }

  const d = action.data as Record<string, string & number & boolean>;

  switch (action.event) {
    case "run_start": {
      const order = (action.data.order as Record<string, unknown>[]) ?? [];
      const unreachable = (action.data.unreachable as string[]) ?? [];
      return {
        ...state,
        runId: String(action.data.run_id ?? ""),
        mode: String(action.data.mode ?? state.mode),
        step: Boolean(action.data.step),
        status: "running",
        startedAt: Date.now(),
        plan: order.map(seg),
        cursor: -1,
        notices: unreachable.length
          ? [
              `${unreachable.length} node${unreachable.length > 1 ? "s" : ""} unreachable — check for a cycle in the graph.`,
            ]
          : [],
      };
    }

    case "node_start": {
      const nodeId = String(action.data.node_id);
      const idx = state.plan.findIndex((s) => s.nodeId === nodeId);
      const next = patch(state, nodeId, (s) => ({
        ...s,
        state: "running",
        startedAt: Date.now(),
      }));
      return { ...next, cursor: idx, status: "running", awaitingStep: null };
    }

    case "node_phase":
      return patch(state, String(d.node_id), (s) => ({
        ...s,
        phase: (action.data.phase as Segment["phase"]) ?? "",
        phaseDetail: String(action.data.detail ?? ""),
      }));

    case "node_reason":
      return patch(state, String(d.node_id), (s) => ({
        ...s,
        blocks: appendText(s.blocks, "reason", String(action.data.chunk ?? "")),
      }));

    case "node_stream":
      return patch(state, String(d.node_id), (s) => ({
        ...s,
        blocks: appendText(s.blocks, "text", String(action.data.chunk ?? "")),
      }));

    case "tool_call": {
      const call: ToolCall = {
        callId: String(action.data.call_id ?? ""),
        name: String(action.data.name ?? ""),
        args: String(action.data.args ?? ""),
      };
      return patch(state, String(d.node_id), (s) => ({
        ...s,
        blocks: [...s.blocks, { kind: "tool", call }],
      }));
    }

    case "tool_result":
      return patch(state, String(d.node_id), (s) => ({
        ...s,
        blocks: s.blocks.map((b) =>
          b.kind === "tool" && b.call.callId === action.data.call_id
            ? {
                kind: "tool",
                call: {
                  ...b.call,
                  ok: Boolean(action.data.ok),
                  result: String(action.data.result ?? ""),
                  durationMs: Number(action.data.duration_ms ?? 0),
                },
              }
            : b
        ),
      }));

    case "node_done": {
      const tokens = Number(action.data.tokens ?? 0);
      const next = patch(state, String(d.node_id), (s) => ({
        ...s,
        state: "done",
        phase: "",
        phaseDetail: "",
        output: String(action.data.output ?? ""),
        tokens,
        latencyMs: Number(action.data.latency_ms ?? 0),
        endedAt: Date.now(),
      }));
      return {
        ...next,
        totals: {
          ...next.totals,
          tokens: next.totals.tokens + tokens,
          nodesRun: next.totals.nodesRun + 1,
        },
      };
    }

    case "node_error":
      return {
        ...patch(state, String(d.node_id), (s) => ({
          ...s,
          state: "error",
          phase: "",
          error: String(action.data.error ?? "Unknown error"),
          endedAt: Date.now(),
        })),
        status: "error",
      };

    case "hitl_pause":
      return {
        ...patch(state, String(d.node_id), (s) => ({
          ...s,
          state: "gate",
          gate: {
            question: String(action.data.question ?? "Approve and continue?"),
            context: String(action.data.context ?? ""),
          },
        })),
        status: "gate",
      };

    case "hitl_resolved":
      return {
        ...patch(state, String(d.node_id), (s) => ({
          ...s,
          gate: s.gate
            ? {
                ...s.gate,
                decision: action.data.decision as "approve" | "reject",
                note: String(action.data.note ?? ""),
              }
            : s.gate,
        })),
        status: "running",
      };

    case "awaiting_step": {
      const next = (action.data.next as Record<string, unknown>) ?? {};
      return {
        ...state,
        status: "paused",
        awaitingStep: {
          nodeId: String(next.node_id ?? ""),
          label: String(next.label ?? ""),
          type: (next.type as NodeType) ?? "llm",
        },
      };
    }

    case "user_message":
      return {
        ...state,
        steers: [
          ...state.steers,
          { text: String(action.data.text ?? ""), atNode: String(action.data.at_node ?? "") },
        ],
      };

    case "run_stopped":
      return { ...state, status: "stopped" };

    case "harness_done": {
      const status = String(action.data.status ?? "complete");
      return {
        ...state,
        status:
          status === "complete" ? "complete" : status === "stopped" ? "stopped" : "error",
        endedAt: Date.now(),
        awaitingStep: null,
        totals: {
          tokens: Number(action.data.total_tokens ?? state.totals.tokens),
          nodesRun: Number(action.data.nodes_run ?? state.totals.nodesRun),
          elapsedMs: Number(action.data.elapsed_ms ?? 0),
        },
        plan: state.plan.map((s) =>
          s.state === "pending" ? { ...s, state: "skipped" } : s
        ),
      };
    }

    case "error":
      return {
        ...state,
        status: "error",
        endedAt: Date.now(),
        notices: [...state.notices, String(action.data.error ?? "Stream error")],
      };

    default:
      return state;
  }
}
