import { describe, expect, it } from "vitest";
import { bundleGraphToEngine } from "./bundleGraph";

describe("bundleGraphToEngine", () => {
  it("maps role/label bundle nodes to engine type+data", () => {
    const graph = bundleGraphToEngine({
      nodes: [
        { id: "PO", role: "PO", label: "PO" },
        { id: "SM", role: "SM", label: "SM" },
      ],
      edges: [{ id: "PO-SM", source: "PO", target: "SM" }],
    });

    expect(graph.nodes).toHaveLength(2);
    expect(graph.nodes[0]).toMatchObject({
      id: "PO",
      type: "llm",
      data: { label: "PO", adapter: "mock" },
    });
    expect(graph.edges[0]).toMatchObject({ source: "PO", target: "SM" });
  });

  it("seeds the first node prompt from the instruction", () => {
    const graph = bundleGraphToEngine(
      { nodes: [{ id: "PO", role: "PO", label: "PO" }], edges: [] },
      "Ship the stop button"
    );
    expect(graph.nodes[0].data).toMatchObject({ prompt: "Ship the stop button" });
  });

  it("passes through xyflow-shaped nodes", () => {
    const graph = bundleGraphToEngine({
      nodes: [
        {
          id: "n1",
          type: "input",
          position: { x: 1, y: 2 },
          data: { label: "In", prompt: "hi" },
        },
      ],
      edges: [],
    });
    expect(graph.nodes[0].type).toBe("input");
    expect(graph.nodes[0].position).toEqual({ x: 1, y: 2 });
    expect(graph.nodes[0].data).toMatchObject({ label: "In", prompt: "hi" });
  });
});
