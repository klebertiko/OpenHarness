import { describe, expect, it } from "vitest";
import { bundleErrorsToProblems, structuralFindings, summarizeReadiness } from "./readiness";
import type { HarnessNode } from "./types";

const n = (id: string, type: HarnessNode["type"], label = id): HarnessNode =>
  ({ id, type, position: { x: 0, y: 0 }, data: { label } }) as HarnessNode;

describe("structuralFindings", () => {
  it("finds nothing in a wired chain: the entry node and the terminal approval are not faults", () => {
    const nodes = [n("a", "agent"), n("g", "gate"), n("h", "hitl")];
    const edges = [{ source: "a", target: "g" }, { source: "g", target: "h" }];
    expect(structuralFindings(nodes, edges)).toEqual([]);
  });

  it("flags only the excess: a second node nothing points at, and a node with nowhere to go", () => {
    const nodes = [n("a", "agent", "Writer"), n("b", "agent", "Orphan"), n("h", "hitl")];
    const edges = [{ source: "a", target: "h" }];
    const found = structuralFindings(nodes, edges);
    expect(found).toContainEqual(expect.objectContaining({ nodeId: "b", note: "never reached", label: "Orphan" }));
    expect(found).toContainEqual(expect.objectContaining({ nodeId: "b", note: "dead end" }));
    expect(found.every((f) => f.severity === "review" && f.source === "structure")).toBe(true);
  });

  it("says when there is no node a run can start from", () => {
    const found = structuralFindings([n("s", "skill")], []);
    expect(found).toContainEqual(expect.objectContaining({ nodeId: null, note: "no agent or gate to start from" }));
  });
});

describe("bundleErrorsToProblems", () => {
  it("links an error to the node it names, and calls the rest harness-level", () => {
    const nodes = [n("gate-7cf3", "gate", "Brief check")];
    const out = bundleErrorsToProblems(["graph.edges[0]: unknown node gate-7cf3", "manifest.version is required"], nodes);
    expect(out[0]).toMatchObject({ nodeId: "gate-7cf3", label: "Brief check", severity: "problem", source: "bundle" });
    expect(out[1]).toMatchObject({ nodeId: null, label: "Harness", note: "manifest.version is required" });
  });
});

describe("summarizeReadiness", () => {
  const base = { nodeCount: 2, structure: [], bundle: { status: "ok" as const, errors: [] } };
  it("covers every state the header pill can show", () => {
    expect(summarizeReadiness({ ...base, nodeCount: 0 })).toMatchObject({ state: "empty", label: "Nothing to check yet" });
    expect(summarizeReadiness({ ...base, bundle: { status: "checking", errors: [] } })).toMatchObject({ state: "checking", label: "Checking…" });
    expect(summarizeReadiness(base)).toMatchObject({ state: "ready", label: "Ready to run" });
    expect(summarizeReadiness({ ...base, bundle: { status: "offline", errors: [] } })).toMatchObject({ state: "offline", label: "Engine offline" });
  });

  it("counts problems before reviews, and reviews do not block", () => {
    const review = { id: "s1", severity: "review" as const, source: "structure" as const, nodeId: "x", label: "X", note: "dead end" };
    const problem = { id: "b1", severity: "problem" as const, source: "bundle" as const, nodeId: null, label: "Harness", note: "bad" };
    expect(summarizeReadiness({ ...base, structure: [review] })).toMatchObject({ state: "review", label: "1 to review", blocking: false });
    const both = summarizeReadiness({ ...base, structure: [review], bundle: { status: "errors", errors: [problem] } });
    expect(both).toMatchObject({ state: "problems", label: "1 problem", blocking: true });
    expect(both.problems.map((p) => p.id)).toEqual(["b1", "s1"]);
    expect(summarizeReadiness({ ...base, bundle: { status: "errors", errors: [problem, { ...problem, id: "b2" }] } }).label).toBe("2 problems");
  });
});
