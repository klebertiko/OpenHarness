import { findPort } from "../ports";
import type { HarnessEdge, HarnessNode } from "../types";
import { EDITABLE, LIMITS, isCatalogType } from "./catalog";
import type { CopilotConfig, CopilotGraph } from "./contract";

/** Truncate by code point so a cut never splits a surrogate pair. */
const clip = (s: string, max: number) => (s.length <= max ? s : Array.from(s).slice(0, max).join(""));

const TEXT_LIMIT: Record<string, number> = {
  roleId: LIMITS.idFieldMax,
  skillId: LIMITS.idFieldMax,
  gateId: LIMITS.idFieldMax,
  systemPrompt: LIMITS.systemPromptMax,
  checklist: LIMITS.checklistMax,
  approvalLabel: LIMITS.approvalLabelMax,
};

function configFor(node: HarnessNode): CopilotConfig {
  if (!isCatalogType(node.type)) return {};
  const config: Record<string, unknown> = {};
  for (const key of EDITABLE[node.type]) {
    const value = node.data[key];
    if (typeof value === "string" && value !== "") config[key] = clip(value, TEXT_LIMIT[key] ?? value.length);
    else if (Array.isArray(value) && value.length > 0) {
      config[key] = value.filter((s): s is string => typeof s === "string").slice(0, LIMITS.signalListMax).map((s) => clip(s, LIMITS.signalMax));
    }
  }
  return config as CopilotConfig;
}

/**
 * Canvas → wire graph through an allowlist: only descriptive, editable fields
 * leave the browser. Provider pins, credentials, endpoints, commands, token
 * limits and runtime output are never serialized.
 */
export function toCopilotGraph(nodes: HarnessNode[], edges: HarnessEdge[]): CopilotGraph {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  return {
    nodes: nodes.map((n) => ({
      id: n.id,
      type: n.type as CopilotGraph["nodes"][number]["type"],
      label: clip(n.data.label ?? "", LIMITS.labelMax),
      config: configFor(n),
    })),
    edges: edges.flatMap((e) => {
      const source = byId.get(e.source);
      const target = byId.get(e.target);
      if (!source || !target) return [];
      return [
        {
          source: e.source,
          sourceHandle: findPort(source.type, "out", e.sourceHandle)?.id ?? e.sourceHandle ?? "",
          target: e.target,
          targetHandle: findPort(target.type, "in", e.targetHandle)?.id ?? e.targetHandle ?? "",
        },
      ];
    }),
  };
}
