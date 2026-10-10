import { PORTS } from "./ports";
import type { HarnessNode, NodeType } from "./types";

/**
 * Readiness: the one answer to "can this harness run?".
 *
 * Two checks feed it. Structure is local and instant (the three faults that
 * actually stop a graph being wireable). The bundle check is the engine's own
 * validation of the composed `.ohm`. Both used to be shown in different places
 * and could disagree (a graph "valid" in one panel and "unwired" in another);
 * here they are merged into one ordered list and one state.
 */

/** `problem` blocks Run; `review` is worth a look but never blocks. */
export type Severity = "problem" | "review";

export interface Problem {
  id: string;
  severity: Severity;
  source: "structure" | "bundle";
  /** The node to reveal, or null when the finding is about the harness as a whole. */
  nodeId: string | null;
  label: string;
  note: string;
}

export type ReadinessState = "empty" | "checking" | "ready" | "review" | "problems" | "offline";

export type BundleCheck =
  | { status: "idle" | "checking" | "ok" | "offline"; errors: Problem[] }
  | { status: "errors"; errors: Problem[] };

export interface Readiness {
  state: ReadinessState;
  label: string;
  problems: Problem[];
  /** Run should explain instead of starting. */
  blocking: boolean;
}

const labelOf = (n: HarnessNode) => String(n.data.label ?? n.id);

/**
 * A wireable graph still has exactly one node nothing points at (where the run
 * starts) and, once a HITL node exists, one node that points nowhere (the
 * terminal approval). Flagging those would make every valid harness look
 * broken, so only the excess is reported: a second orphaned start, or a
 * non-terminal node with nowhere to go.
 */
export function structuralFindings(nodes: HarnessNode[], edges: { source: string; target: string }[]): Problem[] {
  const out: Problem[] = [];
  if (nodes.length === 0) return out;
  const hasIn = new Set(edges.map((e) => e.target));
  const hasOut = new Set(edges.map((e) => e.source));

  if (!nodes.some((n) => n.type === "agent" || n.type === "gate")) {
    out.push({ id: "structure:entry", severity: "review", source: "structure", nodeId: null, label: "Harness", note: "no agent or gate to start from" });
  }
  const unreached = nodes.filter((n) => PORTS[n.type as NodeType].in.length > 0 && !hasIn.has(n.id));
  for (const n of unreached.slice(1)) {
    out.push({ id: `structure:unreached:${n.id}`, severity: "review", source: "structure", nodeId: n.id, label: labelOf(n), note: "never reached" });
  }
  for (const n of nodes) {
    if (n.type === "hitl") continue;
    if (PORTS[n.type as NodeType].out.length > 0 && !hasOut.has(n.id)) {
      out.push({ id: `structure:dead:${n.id}`, severity: "review", source: "structure", nodeId: n.id, label: labelOf(n), note: "dead end" });
    }
  }
  return out;
}

/** The engine returns plain strings; one that names a node id is linked to that node. */
export function bundleErrorsToProblems(errors: string[], nodes: HarnessNode[]): Problem[] {
  return errors.map((message, i) => {
    const hit = nodes.find((n) => message.includes(n.id));
    return {
      id: `bundle:${i}`,
      severity: "problem" as const,
      source: "bundle" as const,
      nodeId: hit ? hit.id : null,
      label: hit ? labelOf(hit) : "Harness",
      note: message,
    };
  });
}

export function summarizeReadiness(input: { nodeCount: number; structure: Problem[]; bundle: BundleCheck }): Readiness {
  const { nodeCount, structure, bundle } = input;
  if (nodeCount === 0) return { state: "empty", label: "Nothing to check yet", problems: [], blocking: false };
  const problems = [...(bundle.status === "errors" ? bundle.errors : []), ...structure];
  const hard = problems.filter((p) => p.severity === "problem").length;
  if (hard > 0) return { state: "problems", label: `${hard} problem${hard === 1 ? "" : "s"}`, problems, blocking: true };
  if (bundle.status === "offline") return { state: "offline", label: "Engine offline", problems, blocking: false };
  if (bundle.status === "checking" || bundle.status === "idle") return { state: "checking", label: "Checking…", problems, blocking: false };
  if (problems.length > 0) return { state: "review", label: `${problems.length} to review`, problems, blocking: false };
  return { state: "ready", label: "Ready to run", problems, blocking: false };
}
