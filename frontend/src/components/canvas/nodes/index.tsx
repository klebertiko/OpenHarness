"use client";
import type { NodeTypes, NodeProps } from "@xyflow/react";
import { BaseNode } from "./BaseNode";
import type { NodeData, NodeType } from "@/lib/types";

/* Two secondary lines are available on a plate, and they are not
   interchangeable:

     spec — mono, for strings a machine produced or consumes: adapter names,
            model ids, sampling numbers, a routing expression.
     note — proportional, for sentences a person wrote: a prompt, the words on
            an approval button.

   Mixing them is the fastest way to make a dense tool look like a dashboard
   mock, so each node type declares which one it gets. */

const compact = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)}k` : String(n));

const modelSpec = (d: NodeData) => {
  const bits = [String(d.adapter ?? "mock"), String(d.model ?? "—")];
  if (typeof d.temperature === "number") bits.push(`t${d.temperature}`);
  if (typeof d.maxTokens === "number") bits.push(compact(d.maxTokens));
  return bits.join(" · ");
};

type Line = { spec?: (d: NodeData) => React.ReactNode; note?: (d: NodeData) => React.ReactNode };

const LINES: Record<NodeType, Line> = {
  input: { note: (d) => (d.prompt ? String(d.prompt) : "no prompt set") },
  output: {},
  llm: { spec: modelSpec },
  evaluator: { spec: modelSpec },
  aggregator: { spec: (d) => `${String(d.adapter ?? "mock")} · fold 3 → 1` },
  tool: { spec: (d) => `${String(d.adapter ?? "mock")} · tool call` },
  router: { spec: (d) => String(d.condition ?? "no condition") },
  hitl: { note: (d) => String(d.approvalLabel ?? "awaiting a person") },
  memory: { spec: () => "buffer · read + write" },
};

function makeNode(type: NodeType) {
  const line = LINES[type];
  function HarnessPlate({ id, data, selected }: NodeProps) {
    const d = data as NodeData;
    return (
      <BaseNode
        id={id}
        type={type}
        data={d}
        selected={selected}
        spec={line.spec?.(d)}
        note={line.note?.(d)}
      />
    );
  }
  HarnessPlate.displayName = `HarnessPlate(${type})`;
  return HarnessPlate;
}

export const nodeTypes: NodeTypes = {
  input: makeNode("input"),
  output: makeNode("output"),
  llm: makeNode("llm"),
  tool: makeNode("tool"),
  evaluator: makeNode("evaluator"),
  router: makeNode("router"),
  hitl: makeNode("hitl"),
  memory: makeNode("memory"),
  aggregator: makeNode("aggregator"),
};
