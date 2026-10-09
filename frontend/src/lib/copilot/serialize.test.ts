import { describe, expect, it } from "vitest";
import { toCopilotGraph } from "./serialize";
import type { HarnessEdge, HarnessNode } from "../types";

const SECRETS = ["vault://openai", "sk-live-123456789012345678901234", "https://evil.example/mcp", "npx evil", "claude-opus"];

const risky: HarnessNode = {
  id: "a1",
  type: "agent",
  position: { x: 0, y: 0 },
  data: {
    label: "Writer",
    roleId: "writer",
    systemPrompt: "You draft.",
    emits: ["Drafted"],
    consumes: [],
    secretRef: SECRETS[0],
    apiKey: SECRETS[1],
    endpoint: SECRETS[2],
    mcpCommand: SECRETS[3],
    mcpUrl: SECRETS[2],
    providerIds: ["conn-1"],
    output: "secret output",
    status: "complete",
    model: SECRETS[4],
    adapter: "openai",
    tokenLimit: 5,
  },
};
const gate: HarnessNode = { id: "g1", type: "gate", position: { x: 0, y: 0 }, data: { label: "Gate", checklist: "- ok", gateId: "" } };
const mcp: HarnessNode = { id: "m1", type: "mcp", position: { x: 0, y: 0 }, data: { label: "Files", mcpCommand: "npx evil", mcpUrl: SECRETS[2] } };
const decision: HarnessNode = { id: "d1", type: "decision", position: { x: 0, y: 0 }, data: { label: "Branch", decisionQuestions: { q: { type: "noul", instructions: "x" } } } };

describe("toCopilotGraph", () => {
  it("serializes with an allowlist: no credential, provider, exec or runtime key survives", () => {
    const graph = toCopilotGraph([risky, gate, mcp, decision], []);
    const text = JSON.stringify(graph);
    for (const secret of SECRETS) expect(text).not.toContain(secret);
    for (const key of ["secretRef", "apiKey", "endpoint", "mcpCommand", "mcpUrl", "providerIds", "output", "status", "model", "adapter", "tokenLimit"]) {
      expect(text).not.toContain(`"${key}"`);
    }
    expect(graph.nodes[0]).toEqual({
      id: "a1",
      type: "agent",
      label: "Writer",
      config: { roleId: "writer", systemPrompt: "You draft.", emits: ["Drafted"] },
    });
  });

  it("drops empty strings and empty arrays, and gives mcp/tool an empty config", () => {
    const graph = toCopilotGraph([gate, mcp], []);
    expect(graph.nodes[0].config).toEqual({ checklist: "- ok" });
    expect(graph.nodes[1].config).toEqual({});
  });

  it("sends decision nodes with label only", () => {
    expect(toCopilotGraph([decision], []).nodes[0]).toEqual({ id: "d1", type: "decision", label: "Branch", config: {} });
  });

  it("normalises null handles through the port schema", () => {
    const edges: HarnessEdge[] = [
      { id: "e1", source: "g1", target: "a1", sourceHandle: null, targetHandle: null },
      { id: "e2", source: "a1", target: "g1" },
    ];
    const graph = toCopilotGraph([risky, gate], edges);
    expect(graph.edges).toEqual([
      { source: "g1", sourceHandle: "pass", target: "a1", targetHandle: "in" },
      { source: "a1", sourceHandle: "out", target: "g1", targetHandle: "in" },
    ]);
  });

  it("drops edges whose endpoints are not on the canvas", () => {
    const edges: HarnessEdge[] = [{ id: "e", source: "ghost", target: "a1" }];
    expect(toCopilotGraph([risky], edges).edges).toEqual([]);
  });

  it("truncates over-long text to the contract limits so the request stays valid", () => {
    const long = { ...risky, data: { ...risky.data, label: "L".repeat(200), systemPrompt: "x".repeat(5000) } };
    const node = toCopilotGraph([long], []).nodes[0];
    expect(node.label).toHaveLength(60);
    expect(node.config.systemPrompt).toHaveLength(4000);
  });
});
