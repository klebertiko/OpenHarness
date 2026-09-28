import type { NodeType } from "./types";

/**
 * Port schema — named ports are the program.
 *
 * Signal edges leave from labelled outs (pass/fail, approve/reject, out).
 * Connection pieces (mcp / tool) expose bind ports Agents can wire to.
 */
export type PortTone = "plain" | "accept" | "reject";

export interface PortDef {
  id: string;
  label: string;
  tone: PortTone;
}

export interface PortSchema {
  in: PortDef[];
  out: PortDef[];
}

const p = (id: string, label: string, tone: PortTone = "plain"): PortDef => ({ id, label, tone });

export const PORTS: Record<NodeType, PortSchema> = {
  agent: {
    in: [p("in", "signal")],
    out: [p("out", "signal")],
  },
  gate: {
    in: [p("in", "entry")],
    out: [p("pass", "pass", "accept"), p("fail", "fail", "reject")],
  },
  hitl: {
    in: [p("in", "proposal")],
    out: [p("approve", "approve", "accept"), p("reject", "reject", "reject")],
  },
  skill: {
    in: [],
    out: [p("out", "attach")],
  },
  mcp: {
    in: [],
    out: [p("tools", "tools")],
  },
  tool: {
    in: [],
    out: [p("call", "call")],
  },
};

export const portRows = (type: NodeType) =>
  Math.max(PORTS[type].in.length, PORTS[type].out.length);

export function findPort(type: NodeType, side: "in" | "out", id?: string | null) {
  const list = PORTS[type][side];
  return list.find((x) => x.id === id) ?? list[0];
}
