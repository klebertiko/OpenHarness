import type { NodeTemplate, HarnessNode, HarnessEdge, NodeStage } from "./types";

/* OHM palette: flow pieces first, Connections second. */

export const STAGE_ORDER: NodeStage[] = ["flow", "connections"];

export const STAGE_LABEL: Record<NodeStage, string> = {
  flow: "Flow",
  connections: "Connections",
};

export const STAGE_NOTE: Record<NodeStage, string> = {
  flow: "Agent · Gate · HITL · Skill — signal graph",
  connections: "McpServer · Tool — bind to Agents",
};

export const NODE_TEMPLATES: NodeTemplate[] = [
  {
    type: "agent",
    label: "Agent",
    description: "Role-bound actor — profile, providers, exit signals",
    stage: "flow",
    defaultData: {
      label: "Agent",
      roleId: "",
      providerIds: [],
      emits: [],
      consumes: [],
      adapter: "mock",
    },
  },
  {
    type: "gate",
    label: "Gate",
    description: "Blocking checkpoint — checklist, pass / fail routes",
    stage: "flow",
    defaultData: {
      label: "Gate",
      gateId: "",
      checklist: "",
      emits: [],
      consumes: [],
    },
  },
  {
    type: "hitl",
    label: "HITL",
    description: "Human authority — merge, Sprint Goal, acceptance",
    stage: "flow",
    defaultData: {
      label: "HITL",
      approvalLabel: "Approve",
    },
  },
  {
    type: "skill",
    label: "Skill",
    description: "Named capability — invoke from an Agent or place on the graph",
    stage: "flow",
    defaultData: {
      label: "Skill",
      skillId: "",
      providerIds: [],
      adapter: "mock",
    },
  },
  {
    type: "mcp",
    label: "McpServer",
    description: "MCP connector — exposes tools to bound Agents",
    stage: "connections",
    defaultData: {
      label: "MCP Server",
      mcpUrl: "",
      mcpCommand: "",
    },
  },
  {
    type: "tool",
    label: "Tool",
    description: "Native tool — HTTP, shell, repo, …",
    stage: "connections",
    defaultData: {
      label: "Tool",
      toolKind: "shell",
      adapter: "mock",
    },
  },
];

export interface HarnessPreset {
  id: string;
  name: string;
  description: string;
  graph: { nodes: HarnessNode[]; edges: HarnessEdge[] };
}

const COL = (i: number) => i * 280;
const ROW = (i: number) => i * 120;

function agent(
  id: string,
  col: number,
  row: number,
  extra: Partial<HarnessNode["data"]> = {}
): HarnessNode {
  return {
    id,
    type: "agent",
    position: { x: COL(col), y: ROW(row) },
    data: {
      label: id,
      roleId: id,
      providerIds: [],
      adapter: "mock",
      ...extra,
    },
  };
}

/**
 * Dogfood preset — skills-framework Agile signal graph.
 * Index 0 is the empty-state / default Studio load.
 */
export const HARNESS_PRESETS: HarnessPreset[] = [
  {
    id: "agile-default",
    name: "Agile role sketch",
    description: "Local visual sketch with simplified role prompts and mock adapters; not the bundled skills-framework OHM.",
    graph: {
      /* Node order mirrors GATES.md's ownership model, not a generic
         checkpoint-then-specialist pipeline: Gate 2/3/4 are each OWNED by
         the specialist agent (QA/ARCH/SEC) themselves — "QA Gate | Owner:
         QA agent", not a separate anonymous checker upstream of them. So
         each gate node sits AFTER its owning agent (the agent's own verdict,
         formalised as OHM's pass/fail branch point — Agent nodes have no
         branching of their own), never before it. Only Gate 1 (Stop-the-Line)
         legitimately precedes its subject: its owner is the Orchestrator,
         not any of the eight named agents. */
      nodes: [
        agent("PO", 0, 2, {
          emits: ['"Sprint-Ready: Story #X"'],
          systemPrompt: "Product Owner — stories, AC, DoD.",
        }),
        {
          id: "gate-stl",
          type: "gate",
          position: { x: COL(1), y: ROW(2) },
          data: {
            label: "Stop-the-Line",
            gateId: "stl",
            checklist: "AC · DoD · points",
            consumes: ['"Sprint-Ready: Story #X"'],
          },
        },
        agent("SM", 2, 2, {
          emits: ['"Sprint <N> started: Goal = <goal>"'],
          systemPrompt: "Scrum Master — ceremonies, blockers.",
        }),
        agent("BE", 3, 1, {
          emits: ['"Ready for QA: Story #X"'],
          consumes: ['"Sprint <N> started: Goal = <goal>"'],
        }),
        agent("FE", 3, 3, {
          emits: ['"Ready for QA: Story #X"'],
          consumes: ['"Sprint <N> started: Goal = <goal>"'],
        }),
        {
          id: "skill-tdd",
          type: "skill",
          position: { x: COL(3), y: ROW(0) },
          data: { label: "tdd", skillId: "tdd", providerIds: [] },
        },
        agent("QA", 4, 1, {
          consumes: ['"Ready for QA: Story #X"'],
          systemPrompt: "QA — always an independent subagent. Tests vs. AC; owns Gate 2.",
        }),
        {
          id: "gate-qa",
          type: "gate",
          position: { x: COL(5), y: ROW(2) },
          data: {
            label: "QA Gate",
            gateId: "qa",
            checklist: "unit · integration · e2e · AC↔tests · DoD · evidence",
            emits: ['"Approved for Architecture Review"'],
          },
        },
        agent("ARCH", 6, 1, {
          systemPrompt: "ARCH — patterns, ADRs, PR creation. Owns Gate 3.",
        }),
        {
          id: "gate-arch",
          type: "gate",
          position: { x: COL(7), y: ROW(2) },
          data: {
            label: "Architecture Gate",
            gateId: "arch",
            checklist: "patterns · ADRs · migrations · perf · PR · evidence",
            emits: ['"Ready for Security Review: PR #<N> — Story #X"'],
          },
        },
        agent("TW", 7, 3, {
          emits: ['"Docs Updated: Story #X"'],
        }),
        agent("SEC", 8, 1, {
          consumes: ['"Ready for Security Review: PR #<N> — Story #X"'],
          systemPrompt: "SEC — always an independent subagent, never the code's author. Owns Gate 4.",
        }),
        {
          id: "gate-sec",
          type: "gate",
          position: { x: COL(9), y: ROW(2) },
          data: {
            label: "Security Gate",
            gateId: "sec",
            checklist: "OWASP · secrets · input validation · injection/XSS/CSRF · auth · CVEs · evidence",
            emits: ['"Ready for HITL Review"'],
          },
        },
        {
          id: "HITL",
          type: "hitl",
          position: { x: COL(10), y: ROW(3) },
          data: {
            /* GATES.md, Gate 5: "Two acceptances happen here and they are
               not the same act." PO judges the demo (accepts, never
               merges); HITL merges (never delegated to PO). This node is
               the merge act only — the demo-acceptance ceremony lives
               outside this per-story graph (Sprint Review, CEREMONIES.md). */
            label: "HITL",
            approvalLabel: "Merge",
            consumes: ['"Ready for HITL Review"'],
          },
        },
      ],
      edges: [
        {
          id: "e-po-stl",
          source: "PO",
          sourceHandle: "out",
          target: "gate-stl",
          targetHandle: "in",
          data: { kind: "flow", signal: "Sprint-Ready: Story #X", label: "Sprint-Ready" },
        },
        {
          id: "e-stl-sm",
          source: "gate-stl",
          sourceHandle: "pass",
          target: "SM",
          targetHandle: "in",
          data: { kind: "accept", signal: "Sprint-Ready", label: "pass" },
        },
        {
          id: "e-sm-be",
          source: "SM",
          sourceHandle: "out",
          target: "BE",
          targetHandle: "in",
          data: { kind: "flow", signal: "Sprint started", label: "assign" },
        },
        {
          id: "e-sm-fe",
          source: "SM",
          sourceHandle: "out",
          target: "FE",
          targetHandle: "in",
          data: { kind: "flow", signal: "Sprint started", label: "assign" },
        },
        {
          id: "e-tdd-be",
          source: "skill-tdd",
          sourceHandle: "out",
          target: "BE",
          targetHandle: "in",
          data: { kind: "flow", signal: "tdd", label: "skill" },
        },
        {
          id: "e-tdd-fe",
          source: "skill-tdd",
          sourceHandle: "out",
          target: "FE",
          targetHandle: "in",
          data: { kind: "flow", signal: "tdd", label: "skill" },
        },
        {
          id: "e-be-qa",
          source: "BE",
          sourceHandle: "out",
          target: "QA",
          targetHandle: "in",
          data: { kind: "flow", signal: "Ready for QA: Story #X", label: "Ready for QA" },
        },
        {
          id: "e-fe-qa",
          source: "FE",
          sourceHandle: "out",
          target: "QA",
          targetHandle: "in",
          data: { kind: "flow", signal: "Ready for QA: Story #X", label: "Ready for QA" },
        },
        {
          id: "e-qa-gate-qa",
          source: "QA",
          sourceHandle: "out",
          target: "gate-qa",
          targetHandle: "in",
          data: { kind: "flow", label: "verdict" },
        },
        {
          id: "e-gate-qa-arch",
          source: "gate-qa",
          sourceHandle: "pass",
          target: "ARCH",
          targetHandle: "in",
          data: { kind: "accept", signal: "Approved for Architecture Review", label: "pass" },
        },
        {
          id: "e-arch-gate-arch",
          source: "ARCH",
          sourceHandle: "out",
          target: "gate-arch",
          targetHandle: "in",
          data: { kind: "flow", label: "review" },
        },
        {
          id: "e-arch-tw",
          source: "ARCH",
          sourceHandle: "out",
          target: "TW",
          targetHandle: "in",
          data: { kind: "flow", label: "docs" },
        },
        {
          id: "e-gate-arch-sec",
          source: "gate-arch",
          sourceHandle: "pass",
          target: "SEC",
          targetHandle: "in",
          data: {
            kind: "accept",
            signal: "Ready for Security Review: PR #<N> — Story #X",
            label: "pass",
          },
        },
        {
          id: "e-sec-gate-sec",
          source: "SEC",
          sourceHandle: "out",
          target: "gate-sec",
          targetHandle: "in",
          data: { kind: "flow", label: "audit" },
        },
        {
          id: "e-gate-sec-hitl",
          source: "gate-sec",
          sourceHandle: "pass",
          target: "HITL",
          targetHandle: "in",
          data: { kind: "accept", signal: "Ready for HITL Review", label: "pass" },
        },
      ],
    },
  },
  {
    id: "minimal-gate",
    name: "Agent + review",
    description: "Smallest OHM loop — one Agent, one Gate, human merge.",
    graph: {
      nodes: [
        {
          id: "impl",
          type: "agent",
          position: { x: COL(0), y: ROW(1) },
          data: {
            label: "Implementer",
            roleId: "BE",
            emits: ["Ready for review"],
            adapter: "mock",
          },
        },
        {
          id: "g1",
          type: "gate",
          position: { x: COL(1), y: ROW(1) },
          data: {
            label: "Review Gate",
            gateId: "review",
            checklist: "tests · AC",
          },
        },
        {
          id: "human",
          type: "hitl",
          position: { x: COL(2), y: ROW(1) },
          data: { label: "HITL", approvalLabel: "Accept" },
        },
      ],
      edges: [
        {
          id: "m1",
          source: "impl",
          sourceHandle: "out",
          target: "g1",
          targetHandle: "in",
          data: { kind: "flow", signal: "Ready for review", label: "Ready for review" },
        },
        {
          id: "m2",
          source: "g1",
          sourceHandle: "pass",
          target: "human",
          targetHandle: "in",
          data: { kind: "accept", label: "pass" },
        },
      ],
    },
  },
];
