import {
  MessageSquare,
  Brain,
  Wrench,
  CheckCircle2,
  GitBranch,
  UserCheck,
  Database,
  Merge,
  Terminal,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { NodeType } from "./types";

/**
 * Role identity for the nine node types.
 *
 * Hue is the only free variable — lightness and chroma are locked in
 * globals.css so nine roles read as one family. The role colour is applied as
 * a 2px rule and a 14px icon, never as a body fill: filled node bodies at nine
 * different hues turn a graph into a bag of sweets, and the eye then has
 * nothing left to spend on execution state, which is the thing that matters.
 */
export const ROLE_VAR: Record<NodeType, string> = {
  input: "var(--role-input)",
  llm: "var(--role-llm)",
  tool: "var(--role-tool)",
  evaluator: "var(--role-evaluator)",
  router: "var(--role-router)",
  hitl: "var(--role-hitl)",
  memory: "var(--role-memory)",
  aggregator: "var(--role-aggregator)",
  output: "var(--role-output)",
};

/** Short machine name — mono, uppercase, used wherever the type is stated. */
export const ROLE_CODE: Record<NodeType, string> = {
  input: "IN",
  llm: "LLM",
  tool: "TOOL",
  evaluator: "EVAL",
  router: "RTE",
  hitl: "HITL",
  memory: "MEM",
  aggregator: "AGG",
  output: "OUT",
};

export const ROLE_ICON: Record<NodeType, LucideIcon> = {
  input: MessageSquare,
  llm: Brain,
  tool: Wrench,
  evaluator: CheckCircle2,
  router: GitBranch,
  hitl: UserCheck,
  memory: Database,
  aggregator: Merge,
  output: Terminal,
};
