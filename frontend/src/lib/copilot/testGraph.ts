/**
 * Test-only helper: the frozen golden base graph as real canvas nodes and
 * edges, with pinned positions so layout assertions are stable.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { NODE_TEMPLATES } from "../templates";
import { edgeForConnection } from "../edges";
import type { HarnessEdge, HarnessNode } from "../types";
import type { CopilotGraph } from "./contract";

const POSITIONS: Record<string, { x: number; y: number }> = {
  a1: { x: 0, y: 0 },
  g1: { x: 280, y: 0 },
  h1: { x: 560, y: 0 },
  s1: { x: 0, y: 160 },
};

export function goldenBaseCanvas(): { nodes: HarnessNode[]; edges: HarnessEdge[] } {
  const examples = JSON.parse(
    readFileSync(path.resolve(__dirname, "../../../../backend/studio_copilot/contract_examples.json"), "utf8"),
  ) as { baseGraph: CopilotGraph };
  const nodes: HarnessNode[] = examples.baseGraph.nodes.map((n) => {
    const template = NODE_TEMPLATES.find((t) => t.type === n.type)!;
    return {
      id: n.id,
      type: n.type as HarnessNode["type"],
      position: { ...POSITIONS[n.id] },
      data: { ...structuredClone(template.defaultData), ...structuredClone(n.config), label: n.label },
    };
  });
  const edges = examples.baseGraph.edges.map((e) =>
    edgeForConnection(nodes.find((n) => n.id === e.source), e),
  );
  return { nodes, edges };
}
