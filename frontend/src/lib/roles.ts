import {
  Bot,
  ShieldCheck,
  UserCheck,
  Sparkles,
  Plug,
  Wrench,
  FlaskConical,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { NodeType } from "./types";

/**
 * Role identity for OHM canvas pieces.
 * Hue varies; lightness/chroma stay locked in globals.css.
 */
export const ROLE_VAR: Record<NodeType, string> = {
  agent: "var(--role-agent)",
  gate: "var(--role-gate)",
  hitl: "var(--role-hitl)",
  skill: "var(--role-skill)",
  mcp: "var(--role-mcp)",
  tool: "var(--role-tool)",
  // EXPERIMENTAL (ADR-0005, spike).
  decision: "var(--role-decision)",
};

export const ROLE_CODE: Record<NodeType, string> = {
  agent: "AGT",
  gate: "GATE",
  hitl: "HITL",
  skill: "SKL",
  mcp: "MCP",
  tool: "TOOL",
  // EXPERIMENTAL (ADR-0005, spike).
  decision: "LAYA",
};

export const ROLE_ICON: Record<NodeType, LucideIcon> = {
  agent: Bot,
  gate: ShieldCheck,
  hitl: UserCheck,
  skill: Sparkles,
  mcp: Plug,
  tool: Wrench,
  // EXPERIMENTAL (ADR-0005, spike) — flask marks it as an experimental probe,
  // deliberately not reusing Gate/HITL's iconography (never a real gate).
  decision: FlaskConical,
};
