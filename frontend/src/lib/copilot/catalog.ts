/**
 * Copilot-facing node catalogue. `PORTS` and `NODE_TEMPLATES` stay canonical;
 * `backend/studio_copilot/catalog.json` mirrors this and a parity test fails
 * on drift. `decision` (ADR-0005) is deliberately not authorable.
 */
import { PORTS } from "../ports";
import { NODE_TEMPLATES } from "../templates";
import type { NodeType } from "../types";

export const CATALOG_TYPES = ["agent", "gate", "hitl", "skill", "mcp", "tool"] as const;
export type CatalogType = (typeof CATALOG_TYPES)[number];

export const EDITABLE: Record<CatalogType, string[]> = {
  agent: ["roleId", "systemPrompt", "emits", "consumes"],
  gate: ["gateId", "checklist", "emits", "consumes"],
  hitl: ["approvalLabel"],
  skill: ["skillId", "systemPrompt"],
  mcp: [],
  tool: [],
};

export const ASSISTABLE: Partial<Record<NodeType, ("systemPrompt" | "checklist")[]>> = {
  agent: ["systemPrompt"],
  skill: ["systemPrompt"],
  gate: ["checklist"],
};

export const LIMITS = {
  maxOps: 40,
  maxNodes: 60,
  maxEdges: 120,
  labelMax: 60,
  idFieldMax: 40,
  systemPromptMax: 4000,
  checklistMax: 2000,
  approvalLabelMax: 40,
  signalListMax: 8,
  signalMax: 60,
} as const;

export function isCatalogType(type: unknown): type is CatalogType {
  return typeof type === "string" && (CATALOG_TYPES as readonly string[]).includes(type);
}

/** Port ids per side for a node type; empty for anything outside the catalogue (e.g. `decision`). */
export function catalogPorts(type: string, side: "in" | "out"): string[] {
  return isCatalogType(type) ? PORTS[type][side].map((p) => p.id) : [];
}

export function buildCatalog() {
  return {
    version: 1,
    limits: { ...LIMITS },
    nodes: CATALOG_TYPES.map((type) => {
      const template = NODE_TEMPLATES.find((t) => t.type === type)!;
      return {
        type,
        label: template.label,
        description: template.description,
        stage: template.stage,
        ports: { in: catalogPorts(type, "in"), out: catalogPorts(type, "out") },
        editable: [...EDITABLE[type]],
      };
    }),
    assistableFields: Object.fromEntries(Object.entries(ASSISTABLE).map(([k, v]) => [k, [...v!]])),
  };
}
