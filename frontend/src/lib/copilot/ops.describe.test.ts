import { describe, expect, it } from "vitest";
import { describeOps } from "./ops";
import type { CopilotGraph, Op } from "./contract";

const graph: CopilotGraph = {
  nodes: [
    { id: "a1", type: "agent", label: "Writer", config: {} },
    { id: "g1", type: "gate", label: "Review Gate", config: {} },
    { id: "t1", type: "tool", label: "shell", config: {} },
  ],
  edges: [{ source: "a1", sourceHandle: "out", target: "g1", targetHandle: "in" }],
};

describe("describeOps", () => {
  it("add_and_wire gives +, → and → lines that quote labels, never raw ids", () => {
    const ops: Op[] = [
      { op: "addNode", ref: "n1", type: "agent", label: "Reviewer" },
      { op: "connect", from: "g1", fromPort: "fail", to: "n1" },
      { op: "connect", from: "n1", to: "g1" },
    ];
    const lines = describeOps(ops, graph);
    expect(lines.map((l) => l.glyph)).toEqual(["+", "→", "→"]);
    expect(lines[0].text).toBe('Agent "Reviewer"');
    expect(lines[1].text).toBe('Review Gate fail → Reviewer');
    expect(lines[2].text).toBe('Reviewer → Review Gate');
    for (const l of lines) expect(l.text).not.toMatch(/\b(g1|a1|n1)\b/);
  });

  it("describes update, remove and disconnect", () => {
    const lines = describeOps(
      [
        { op: "updateNode", id: "g1", config: { checklist: "- x" } },
        { op: "updateNode", id: "a1", label: "Author" },
        { op: "removeNode", id: "t1" },
        { op: "disconnect", from: "a1", to: "g1" },
      ],
      graph,
    );
    expect(lines.map((l) => l.glyph)).toEqual(["~", "~", "−", "×"]);
    expect(lines[0].text).toBe("Review Gate · checklist");
    expect(lines[1].text).toBe('Writer · renamed "Author"');
    expect(lines[2].text).toBe('Tool "shell"');
    expect(lines[3].text).toBe("Writer → Review Gate");
  });

  it("links existing nodes by id so the card can select them", () => {
    const lines = describeOps([{ op: "updateNode", id: "g1", label: "G" }], graph);
    expect(lines[0].nodeId).toBe("g1");
  });
});
