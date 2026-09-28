import {
  Bot,
  ShieldCheck,
  UserCheck,
  Sparkles,
  Plug,
  Wrench,
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
};

export const ROLE_CODE: Record<NodeType, string> = {
  agent: "AGT",
  gate: "GATE",
  hitl: "HITL",
  skill: "SKL",
  mcp: "MCP",
  tool: "TOOL",
};

export const ROLE_ICON: Record<NodeType, LucideIcon> = {
  agent: Bot,
  gate: ShieldCheck,
  hitl: UserCheck,
  skill: Sparkles,
  mcp: Plug,
  tool: Wrench,
};
