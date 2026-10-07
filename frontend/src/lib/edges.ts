import { PORTS, findPort } from "./ports";
import type { EdgeKind, HarnessEdge, HarnessNode } from "./types";

export interface Connectionish {
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
}

/* A new wire inherits its meaning from the port it leaves: the reader never has
   to be told what a branch means, and the author never has to style one. This
   is the single place that decoration lives (canvas drag, Copilot ops). */
export function edgeForConnection(source: HarnessNode | undefined, c: Connectionish): HarnessEdge {
  const port = source ? findPort(source.type, "out", c.sourceHandle) : undefined;
  const sourceHandle = port?.id ?? c.sourceHandle ?? "out";
  const targetHandle = c.targetHandle ?? "in";
  const kind: EdgeKind = port?.tone === "accept" ? "accept" : port?.tone === "reject" ? "reject" : "flow";
  return {
    id: `e-${c.source}-${sourceHandle}-${c.target}-${targetHandle}`,
    type: "harness",
    source: c.source,
    target: c.target,
    sourceHandle,
    targetHandle,
    data: { kind, label: port && source && PORTS[source.type].out.length > 1 ? port.label : undefined },
  };
}
