import type { NodeType } from "./types";

/**
 * Port schema — the single most important decision in this canvas.
 *
 * A generic graph editor gives every node one anonymous dot on each side and
 * lets the edges mean whatever the reader assumes. An agent harness cannot
 * afford that: the difference between the branch an evaluator takes on PASS and
 * the branch it takes on FAIL *is* the program. So every node declares named,
 * typed ports, they are drawn as labelled rows inside the node body, and every
 * edge leaves from a port the reader can name.
 *
 * `tone` is not decoration. It is the branch's semantics, and the edge that
 * leaves the port inherits it — a `reject` port always produces a red-tinted
 * dashed edge, everywhere, forever. Three tones, no more:
 *   accept  — the happy path out of a decision
 *   reject  — the refusal / failure path out of a decision
 *   plain   — unconditional flow
 */
export type PortTone = "plain" | "accept" | "reject";

export interface PortDef {
  id: string;
  /** Drawn inside the node. Lowercase on purpose: these are wire names. */
  label: string;
  tone: PortTone;
}

export interface PortSchema {
  in: PortDef[];
  out: PortDef[];
}

const p = (id: string, label: string, tone: PortTone = "plain"): PortDef => ({ id, label, tone });

export const PORTS: Record<NodeType, PortSchema> = {
  input: { in: [], out: [p("out", "prompt")] },
  memory: { in: [p("write", "write")], out: [p("read", "read")] },
  llm: { in: [p("in", "context")], out: [p("out", "completion")] },
  tool: { in: [p("in", "call")], out: [p("out", "result")] },
  aggregator: { in: [p("a", "a"), p("b", "b"), p("c", "c")], out: [p("out", "merged")] },
  evaluator: {
    in: [p("in", "candidate")],
    out: [p("pass", "pass", "accept"), p("fail", "fail", "reject")],
  },
  router: {
    in: [p("in", "input")],
    out: [p("match", "match", "accept"), p("else", "else")],
  },
  hitl: {
    in: [p("in", "proposal")],
    out: [p("approve", "approve", "accept"), p("reject", "reject", "reject")],
  },
  output: { in: [p("in", "result")], out: [] },
};

/** Rows a node body needs: inputs and outputs share rows, longest side wins. */
export const portRows = (type: NodeType) =>
  Math.max(PORTS[type].in.length, PORTS[type].out.length);

export function findPort(type: NodeType, side: "in" | "out", id?: string | null) {
  const list = PORTS[type][side];
  return list.find((x) => x.id === id) ?? list[0];
}
