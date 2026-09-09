import type { NodeTemplate, HarnessNode, HarnessEdge, NodeStage } from "./types";

/* ═══════════════════════════════════════════════════════════════════════════
   Palette content.

   Nine node types used to sit in one undifferentiated list. They are now
   grouped into the four stages a harness actually has — where work enters and
   leaves it, what does the thinking, what decides, and what remembers. The
   grouping is the teaching: someone who has never built a harness can read the
   palette top to bottom and learn the shape of one.
   ═══════════════════════════════════════════════════════════════════════════ */

export const STAGE_ORDER: NodeStage[] = ["boundary", "compute", "control", "state"];

export const STAGE_LABEL: Record<NodeStage, string> = {
  boundary: "Boundary",
  compute: "Compute",
  control: "Control",
  state: "State",
};

export const STAGE_NOTE: Record<NodeStage, string> = {
  boundary: "where a run enters and leaves",
  compute: "what spends tokens",
  control: "what decides the next hop",
  state: "what survives between hops",
};

export const NODE_TEMPLATES: NodeTemplate[] = [
  {
    type: "input",
    label: "Input",
    description: "Entry point — the prompt a run starts from",
    stage: "boundary",
    defaultData: { label: "Input", prompt: "Enter your query here..." },
  },
  {
    type: "output",
    label: "Output",
    description: "Terminal — the answer a run resolves to",
    stage: "boundary",
    defaultData: { label: "Output" },
  },
  {
    type: "llm",
    label: "LLM Agent",
    description: "One completion against any provider you hold a key for",
    stage: "compute",
    defaultData: {
      label: "LLM Agent",
      adapter: "mock",
      model: "gpt-4o-mini",
      systemPrompt: "You are a helpful assistant.",
      temperature: 0.7,
      maxTokens: 4096,
    },
  },
  {
    type: "tool",
    label: "Tool / MCP",
    description: "Shell, HTTP or MCP server call — the agent's hands",
    stage: "compute",
    defaultData: { label: "Tool", adapter: "mock" },
  },
  {
    type: "aggregator",
    label: "Aggregator",
    description: "Folds up to three upstream results into one context",
    stage: "compute",
    defaultData: { label: "Aggregator", adapter: "mock" },
  },
  {
    type: "evaluator",
    label: "Evaluator",
    description: "Scores a candidate and forks it to pass or fail",
    stage: "control",
    defaultData: {
      label: "Evaluator",
      adapter: "mock",
      model: "gpt-4o-mini",
      systemPrompt: "Evaluate the following output. Respond with PASS or FAIL and a score 1-10.",
    },
  },
  {
    type: "router",
    label: "Router",
    description: "Forks on a condition — match, or fall through to else",
    stage: "control",
    defaultData: { label: "Router", condition: "output.includes('PASS')" },
  },
  {
    type: "hitl",
    label: "Human Review",
    description: "Halts the run until a person approves or rejects",
    stage: "control",
    defaultData: { label: "Human Review", approvalLabel: "Approve to continue" },
  },
  {
    type: "memory",
    label: "Memory",
    description: "Context buffer written on the way through, read on the way back",
    stage: "state",
    defaultData: { label: "Memory" },
  },
];

/* ═══════════════════════════════════════════════════════════════════════════
   Presets.

   Every edge names the port it leaves from, because a preset is the main way
   someone learns that ports exist. Order matters to one caller: the empty
   stage on the home route offers `HARNESS_PRESETS[1]` by name as "Critic
   Gate", so Critic Gate stays at index 1.
   ═══════════════════════════════════════════════════════════════════════════ */

export interface HarnessPreset {
  id: string;
  name: string;
  description: string;
  graph: { nodes: HarnessNode[]; edges: HarnessEdge[] };
}

/** Column pitch: node plate is 212px, so 280 leaves 68px of wire per hop. */
const COL = (i: number) => i * 280;

export const HARNESS_PRESETS: HarnessPreset[] = [
  {
    id: "react-loop",
    name: "ReAct Loop",
    description: "Reason, act through a tool, feed the result back, repeat until final.",
    graph: {
      nodes: [
        {
          id: "react-input",
          type: "input",
          position: { x: COL(0), y: 150 },
          data: { label: "Task", prompt: "Summarise today's build failures." },
        },
        {
          id: "react-agent",
          type: "llm",
          position: { x: COL(1), y: 150 },
          data: {
            label: "Reasoner",
            adapter: "claude",
            model: "claude-sonnet-4",
            systemPrompt: "Think step by step. Call a tool when you need facts.",
            temperature: 0.4,
            maxTokens: 2048,
          },
        },
        {
          id: "react-tool",
          type: "tool",
          position: { x: COL(2), y: 0 },
          data: { label: "Shell / MCP", adapter: "mock" },
        },
        {
          id: "react-router",
          type: "router",
          position: { x: COL(2), y: 190 },
          data: { label: "Final answer?", condition: "output.startsWith('FINAL')" },
        },
        {
          id: "react-output",
          type: "output",
          position: { x: COL(3), y: 190 },
          data: { label: "Answer" },
        },
      ],
      edges: [
        { id: "e1", source: "react-input", sourceHandle: "out", target: "react-agent", targetHandle: "in" },
        { id: "e2", source: "react-agent", sourceHandle: "out", target: "react-tool", targetHandle: "in" },
        { id: "e3", source: "react-tool", sourceHandle: "out", target: "react-agent", targetHandle: "in" },
        { id: "e4", source: "react-agent", sourceHandle: "out", target: "react-router", targetHandle: "in" },
        {
          id: "e5",
          source: "react-router",
          sourceHandle: "match",
          target: "react-output",
          targetHandle: "in",
          data: { kind: "accept", label: "match" },
        },
        {
          id: "e6",
          source: "react-router",
          sourceHandle: "else",
          target: "react-agent",
          targetHandle: "in",
          data: { kind: "flow", label: "else" },
        },
      ],
    },
  },
  {
    id: "critic-gate",
    name: "Critic Gate",
    description: "Draft, score, revise on failure, and hold at a person before release.",
    graph: {
      nodes: [
        {
          id: "cg-input",
          type: "input",
          position: { x: COL(0), y: 120 },
          data: { label: "Brief", prompt: "Draft the release note for OpenHarness v0.4." },
        },
        {
          id: "cg-memory",
          type: "memory",
          position: { x: COL(0), y: 300 },
          data: { label: "Style Guide" },
        },
        {
          id: "cg-writer",
          type: "llm",
          position: { x: COL(1), y: 200 },
          data: {
            label: "Writer",
            adapter: "claude",
            model: "claude-sonnet-4",
            systemPrompt: "You are a precise technical writer. Keep it under 120 words.",
            temperature: 0.7,
            maxTokens: 4096,
          },
        },
        {
          id: "cg-lint",
          type: "tool",
          position: { x: COL(1), y: 400 },
          data: { label: "Style Lint", adapter: "mock" },
        },
        {
          id: "cg-critic",
          type: "evaluator",
          position: { x: COL(2), y: 200 },
          data: {
            label: "Critic",
            adapter: "openai",
            model: "gpt-4o-mini",
            systemPrompt: "Score 1-10. Reply PASS or FAIL with one reason.",
            temperature: 0,
          },
        },
        {
          id: "cg-review",
          type: "hitl",
          position: { x: COL(3), y: 140 },
          data: { label: "Sign-off", approvalLabel: "Approve to publish" },
        },
        {
          id: "cg-output",
          type: "output",
          position: { x: COL(4), y: 140 },
          data: { label: "Release Note" },
        },
      ],
      edges: [
        { id: "g1", source: "cg-input", sourceHandle: "out", target: "cg-writer", targetHandle: "in" },
        { id: "g2", source: "cg-memory", sourceHandle: "read", target: "cg-writer", targetHandle: "in" },
        { id: "g3", source: "cg-writer", sourceHandle: "out", target: "cg-critic", targetHandle: "in" },
        { id: "g4", source: "cg-lint", sourceHandle: "out", target: "cg-critic", targetHandle: "in" },
        {
          id: "g5",
          source: "cg-critic",
          sourceHandle: "fail",
          target: "cg-writer",
          targetHandle: "in",
          data: { kind: "reject", label: "fail" },
        },
        {
          id: "g6",
          source: "cg-critic",
          sourceHandle: "pass",
          target: "cg-review",
          targetHandle: "in",
          data: { kind: "accept", label: "pass" },
        },
        {
          id: "g7",
          source: "cg-review",
          sourceHandle: "approve",
          target: "cg-output",
          targetHandle: "in",
          data: { kind: "accept", label: "approve" },
        },
        {
          id: "g8",
          source: "cg-review",
          sourceHandle: "reject",
          target: "cg-writer",
          targetHandle: "in",
          data: { kind: "reject", label: "reject" },
        },
      ],
    },
  },
  {
    id: "research-desk",
    name: "Research Desk",
    description: "Fan out to two tools, merge the findings, then synthesise and fact-check.",
    graph: {
      nodes: [
        {
          id: "rd-input",
          type: "input",
          position: { x: COL(0), y: 190 },
          data: { label: "Question", prompt: "What changed in our auth flow last quarter?" },
        },
        {
          id: "rd-search",
          type: "tool",
          position: { x: COL(1), y: 20 },
          data: { label: "Web Search", adapter: "mock" },
        },
        {
          id: "rd-grep",
          type: "tool",
          position: { x: COL(1), y: 210 },
          data: { label: "Repo Grep", adapter: "mock" },
        },
        {
          id: "rd-mem",
          type: "memory",
          position: { x: COL(1), y: 400 },
          data: { label: "Session Notes" },
        },
        {
          id: "rd-merge",
          type: "aggregator",
          position: { x: COL(2), y: 200 },
          data: { label: "Merge Findings", adapter: "mock" },
        },
        {
          id: "rd-synth",
          type: "llm",
          position: { x: COL(3), y: 200 },
          data: {
            label: "Synthesiser",
            adapter: "claude",
            model: "claude-sonnet-4",
            systemPrompt: "Cite every claim against the merged findings.",
            temperature: 0.3,
            maxTokens: 8192,
          },
        },
        {
          id: "rd-check",
          type: "evaluator",
          position: { x: COL(4), y: 200 },
          data: {
            label: "Fact Check",
            adapter: "openai",
            model: "gpt-4o-mini",
            systemPrompt: "Verify each citation. PASS only if all resolve.",
            temperature: 0,
          },
        },
        {
          id: "rd-output",
          type: "output",
          position: { x: COL(5), y: 140 },
          data: { label: "Answer" },
        },
      ],
      edges: [
        { id: "r1", source: "rd-input", sourceHandle: "out", target: "rd-search", targetHandle: "in" },
        { id: "r2", source: "rd-input", sourceHandle: "out", target: "rd-grep", targetHandle: "in" },
        { id: "r3", source: "rd-search", sourceHandle: "out", target: "rd-merge", targetHandle: "a" },
        { id: "r4", source: "rd-grep", sourceHandle: "out", target: "rd-merge", targetHandle: "b" },
        { id: "r5", source: "rd-mem", sourceHandle: "read", target: "rd-merge", targetHandle: "c" },
        { id: "r6", source: "rd-merge", sourceHandle: "out", target: "rd-synth", targetHandle: "in" },
        { id: "r7", source: "rd-synth", sourceHandle: "out", target: "rd-check", targetHandle: "in" },
        {
          id: "r8",
          source: "rd-check",
          sourceHandle: "pass",
          target: "rd-output",
          targetHandle: "in",
          data: { kind: "accept", label: "pass" },
        },
        {
          id: "r9",
          source: "rd-check",
          sourceHandle: "fail",
          target: "rd-synth",
          targetHandle: "in",
          data: { kind: "reject", label: "fail" },
        },
      ],
    },
  },
];
