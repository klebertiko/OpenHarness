import { describe, expect, it } from "vitest";
import { diffMarks, materializeOps } from "./ops";
import { goldenBaseCanvas } from "./testGraph";
import type { Op } from "./contract";
import type { HarnessNode } from "../types";

const byId = (nodes: HarnessNode[], id: string) => nodes.find((n) => n.id === id)!;

describe("materializeOps", () => {
  it("add_and_wire creates a template-defaulted node, avoids the h1 collision and decorates edges", () => {
    const { nodes, edges } = goldenBaseCanvas();
    const ops: Op[] = [
      { op: "addNode", ref: "n1", type: "agent", label: "Reviewer", config: { roleId: "reviewer", systemPrompt: "You review drafts.", emits: ["Reviewed"] }, near: "g1" },
      { op: "connect", from: "g1", fromPort: "fail", to: "n1" },
      { op: "connect", from: "n1", to: "g1", toPort: "in" },
    ];
    const out = materializeOps(nodes, edges, ops, { newId: () => "x1" });
    expect(out.refToId).toEqual({ n1: "agent-x1" });
    const added = byId(out.nodes, "agent-x1");
    expect(added.type).toBe("agent");
    expect(added.data).toMatchObject({ label: "Reviewer", adapter: "mock", roleId: "reviewer", systemPrompt: "You review drafts.", emits: ["Reviewed"] });
    expect(added.position).toEqual({ x: 560, y: 120 });
    expect(out.nodes).toHaveLength(5);
    expect(out.edges).toHaveLength(4);
    const fail = out.edges.find((e) => e.source === "g1" && e.target === "agent-x1")!;
    expect(fail).toMatchObject({ id: "e-g1-fail-agent-x1-in", type: "harness", sourceHandle: "fail", targetHandle: "in", data: { kind: "reject", label: "fail" } });
  });

  it("does not mutate its inputs", () => {
    const { nodes, edges } = goldenBaseCanvas();
    const before = JSON.stringify({ nodes, edges });
    materializeOps(nodes, edges, [{ op: "addNode", ref: "n1", type: "agent", label: "X" }], { newId: () => "q" });
    expect(JSON.stringify({ nodes, edges })).toBe(before);
  });

  it("stacks two new nodes anchored on the same node 120px apart", () => {
    const { nodes, edges } = goldenBaseCanvas();
    const out = materializeOps(
      nodes,
      edges,
      [
        { op: "addNode", ref: "n1", type: "agent", label: "A", near: "s1" },
        { op: "addNode", ref: "n2", type: "agent", label: "B", near: "s1" },
      ],
      { newId: (() => { let i = 0; return () => `k${++i}`; })() },
    );
    expect(byId(out.nodes, "agent-k1").position).toEqual({ x: 280, y: 160 });
    expect(byId(out.nodes, "agent-k2").position).toEqual({ x: 280, y: 280 });
  });

  it("places a skill below the agent it attaches to", () => {
    const nodes: HarnessNode[] = [{ id: "far", type: "agent", position: { x: 1000, y: 0 }, data: { label: "Far" } }];
    const out = materializeOps(nodes, [], [
      { op: "addNode", ref: "n1", type: "skill", label: "tdd", config: { skillId: "tdd" } },
      { op: "connect", from: "n1", to: "far" },
    ], { newId: () => "s" });
    expect(byId(out.nodes, "skill-s").position).toEqual({ x: 1000, y: 160 });
  });

  it("anchors a flow node on its first incoming connect source, including earlier new nodes", () => {
    const out = materializeOps([], [], [
      { op: "addNode", ref: "n1", type: "agent", label: "One" },
      { op: "addNode", ref: "n2", type: "agent", label: "Two" },
      { op: "connect", from: "n1", to: "n2" },
    ], { newId: (() => { let i = 0; return () => `z${++i}`; })() });
    expect(byId(out.nodes, "agent-z1").position).toEqual({ x: 0, y: 0 });
    expect(byId(out.nodes, "agent-z2").position).toEqual({ x: 280, y: 0 });
  });

  it("puts the first node of an empty graph at the origin and unanchored nodes right of the existing ones", () => {
    const empty = materializeOps([], [], [{ op: "addNode", ref: "n1", type: "agent", label: "First" }], { newId: () => "f" });
    expect(empty.nodes[0].position).toEqual({ x: 0, y: 0 });
    const { nodes, edges } = goldenBaseCanvas();
    const out = materializeOps(nodes, edges, [{ op: "addNode", ref: "n1", type: "agent", label: "Free" }], { newId: () => "u" });
    expect(byId(out.nodes, "agent-u").position).toEqual({ x: 840, y: 0 });
  });

  it("applies update, remove and disconnect", () => {
    const { nodes, edges } = goldenBaseCanvas();
    const out = materializeOps(nodes, edges, [
      { op: "updateNode", id: "g1", label: "QA Gate", config: { checklist: "- a\n- b" } },
      { op: "disconnect", from: "g1", fromPort: "pass", to: "h1" },
      { op: "removeNode", id: "a1" },
    ]);
    expect(byId(out.nodes, "g1").data).toMatchObject({ label: "QA Gate", checklist: "- a\n- b" });
    expect(out.nodes.some((n) => n.id === "a1")).toBe(false);
    expect(out.edges).toEqual([]);
  });
});

describe("diffMarks", () => {
  it("marks added and changed nodes by label or editable fields", () => {
    const { nodes } = goldenBaseCanvas();
    const after = [
      ...nodes.map((n) => (n.id === "g1" ? { ...n, data: { ...n.data, checklist: "- different" } } : n.id === "a1" ? { ...n, data: { ...n.data, status: "complete" as const } } : n)),
      { id: "agent-new", type: "agent" as const, position: { x: 0, y: 0 }, data: { label: "New" } },
    ];
    expect(diffMarks(nodes, after)).toEqual({ g1: "changed", "agent-new": "added" });
  });
});
