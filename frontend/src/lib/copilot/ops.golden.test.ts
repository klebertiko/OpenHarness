import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { validateOps } from "./ops";
import type { CopilotGraph } from "./contract";

const examples = JSON.parse(
  readFileSync(path.resolve(__dirname, "../../../../backend/studio_copilot/contract_examples.json"), "utf8"),
) as {
  baseGraph: CopilotGraph;
  cases: { name: string; ops: unknown[]; expect: { ok: boolean; nodes?: number; edges?: number; index?: number; code?: string } }[];
};

describe("validateOps — golden parity with backend/studio_copilot/ops.py", () => {
  it("covers the 32 frozen cases", () => {
    expect(examples.cases).toHaveLength(32);
  });

  for (const c of examples.cases) {
    it(c.name, () => {
      const result = validateOps(examples.baseGraph, c.ops);
      if (c.expect.ok) {
        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.graph.nodes).toHaveLength(c.expect.nodes!);
          expect(result.graph.edges).toHaveLength(c.expect.edges!);
        }
      } else {
        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.errors).toHaveLength(1);
          expect(result.errors[0].index).toBe(c.expect.index);
          expect(result.errors[0].code).toBe(c.expect.code);
          expect(result.errors[0].message).not.toBe("");
        }
      }
    });

    it(`${c.name} never mutates its inputs`, () => {
      const graph = structuredClone(examples.baseGraph);
      const ops = structuredClone(c.ops);
      validateOps(graph, ops);
      expect(graph).toEqual(examples.baseGraph);
      expect(ops).toEqual(c.ops);
    });
  }

  it("rejects a 61st node with graph_limit at the op that crosses it", () => {
    const graph: CopilotGraph = {
      nodes: Array.from({ length: 59 }, (_, i) => ({ id: `a${i}`, type: "agent" as const, label: `A${i}`, config: {} })),
      edges: [],
    };
    const result = validateOps(graph, [
      { op: "addNode", ref: "n1", type: "agent", label: "One" },
      { op: "addNode", ref: "n2", type: "agent", label: "Two" },
    ]);
    expect(result).toMatchObject({ ok: false, errors: [{ index: 1, code: "graph_limit" }] });
  });

  it("treats decision nodes as present but unwireable", () => {
    const graph: CopilotGraph = {
      nodes: [
        { id: "d1", type: "decision", label: "Branch", config: {} },
        { id: "a1", type: "agent", label: "A", config: {} },
      ],
      edges: [],
    };
    expect(validateOps(graph, [{ op: "connect", from: "d1", to: "a1" }])).toMatchObject({ errors: [{ code: "bad_port" }] });
    expect(validateOps(graph, [{ op: "connect", from: "a1", to: "d1" }])).toMatchObject({ errors: [{ code: "no_input_port" }] });
    expect(validateOps(graph, [{ op: "removeNode", id: "d1" }]).ok).toBe(true);
  });

  it("resolves refs to synthetic ref:<ref> ids in the result", () => {
    const result = validateOps(examples.baseGraph, [
      { op: "addNode", ref: "n1", type: "agent", label: "Reviewer" },
      { op: "connect", from: "n1", to: "g1" },
    ]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.graph.nodes.map((n) => n.id)).toContain("ref:n1");
      expect(result.graph.edges.some((e) => e.source === "ref:n1" && e.target === "g1")).toBe(true);
    }
  });

  it("rejects credential, provider and exec keys everywhere", () => {
    for (const key of ["secretRef", "apiKey", "endpoint", "mcpCommand", "mcpUrl", "providerIds", "adapter", "model", "cwd", "toolKind"]) {
      for (const id of ["a1", "g1", "h1", "s1"]) {
        expect(validateOps(examples.baseGraph, [{ op: "updateNode", id, config: { [key]: "x" } }])).toMatchObject({
          errors: [{ code: "field_not_editable" }],
        });
      }
    }
  });

  it("keeps ref:<n> private to the validator (QA M2)", () => {
    const add = { op: "addNode", ref: "n2", type: "gate", label: "G" };
    for (const follow of [
      { op: "removeNode", id: "ref:n2" },
      { op: "updateNode", id: "ref:n2", label: "X" },
      { op: "connect", from: "ref:n2", to: "g1" },
      { op: "addNode", ref: "n3", type: "agent", label: "A", near: "ref:n2" },
    ]) {
      expect(validateOps(examples.baseGraph, [add, follow])).toMatchObject({ errors: [{ index: 1, code: "unknown_node" }] });
    }
    const odd: CopilotGraph = { nodes: [{ id: "ref:n1", type: "agent", label: "Odd", config: {} }], edges: [] };
    expect(validateOps(odd, [{ op: "addNode", ref: "n1", type: "agent", label: "X" }])).toMatchObject({ errors: [{ code: "bad_ref" }] });
  });

  it("treats a non-string op field as unknown_op", () => {
    for (const op of [["addNode"], {}, { a: 1 }, 7, null, true]) {
      expect(validateOps(examples.baseGraph, [{ op }])).toMatchObject({ errors: [{ code: "unknown_op" }] });
    }
  });

  it("trims labels exactly like the Python validator", () => {
    const run = (label: string) => validateOps(examples.baseGraph, [{ op: "updateNode", id: "s1", label }]).ok;
    expect(run("\x1c")).toBe(true);
    expect(run("\x85")).toBe(true);
    expect(run("﻿")).toBe(false);
    expect(run(" ")).toBe(false);
    expect(run("　x　")).toBe(true);
  });

  it("flags non-object ops as unknown_op and wrong shapes as field_invalid", () => {
    expect(validateOps(examples.baseGraph, ["addNode"])).toMatchObject({ errors: [{ code: "unknown_op" }] });
    for (const bad of [
      { op: "addNode", ref: "n1", type: "agent", label: "X", provider: "openai" },
      { op: "addNode", ref: "n1", type: "agent" },
      { op: "updateNode", id: "a1", label: "X", config: "nope" },
      { op: "connect", from: "a1", to: ["g1"] },
      { op: "updateNode", id: "a1", config: { emits: "Reviewed" } },
    ]) {
      expect(validateOps(examples.baseGraph, [bad])).toMatchObject({ errors: [{ code: "field_invalid" }] });
    }
  });
});
