"use client";
import type { NodeTypes, NodeProps } from "@xyflow/react";
import { useProviderStore } from "@/components/providers/providerStore";
import { useCanvasStore } from "@/store/canvasStore";
import { nodeProviderSummary } from "../nodeProvider";
import { BaseNode } from "./BaseNode";
import type { NodeData, NodeType } from "@/lib/types";

type Line = { spec?: (d: NodeData) => React.ReactNode; note?: (d: NodeData) => React.ReactNode };

const LINES: Record<NodeType, Line> = {
  agent: {
    note: (d) => (d.roleId ? `role ${d.roleId}` : "bind a role profile"),
  },
  gate: {
    note: (d) => (d.checklist ? String(d.checklist) : "checklist empty"),
  },
  hitl: {
    note: (d) => String(d.approvalLabel ?? "awaiting a person"),
  },
  skill: {
    note: (d) => (d.skillId ? `skill ${d.skillId}` : "name a skill id"),
  },
  mcp: {
    spec: (d) => String(d.mcpUrl || d.mcpCommand || "configure transport"),
  },
  tool: {
    spec: (d) => `${String(d.toolKind ?? "shell")} · ${String(d.adapter ?? "mock")}`,
  },
};

function makeNode(type: NodeType) {
  const line = LINES[type];
  function HarnessPlate({ id, data, selected }: NodeProps) {
    const d = data as NodeData;
    const connections = useProviderStore(s => s.connections);
    const mode = useCanvasStore(s => s.executionMode);
    return (
      <BaseNode
        id={id}
        type={type}
        data={d}
        selected={selected}
        spec={type === "agent" || type === "skill" ? nodeProviderSummary(d, mode, connections) : line.spec?.(d)}
        note={line.note?.(d)}
      />
    );
  }
  HarnessPlate.displayName = `HarnessPlate(${type})`;
  return HarnessPlate;
}

export const nodeTypes: NodeTypes = {
  agent: makeNode("agent"),
  gate: makeNode("gate"),
  hitl: makeNode("hitl"),
  skill: makeNode("skill"),
  mcp: makeNode("mcp"),
  tool: makeNode("tool"),
};
