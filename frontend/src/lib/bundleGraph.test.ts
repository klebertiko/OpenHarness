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
      type: "agent",
      data: { label: "PO" },
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

  it("passes through xyflow-shaped nodes, normalising a legacy type to the OHM vocabulary", () => {
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
    // "input" is a legacy pipeline-node type; resolveType maps it to "agent".
    expect(graph.nodes[0].type).toBe("agent");
    expect(graph.nodes[0].position).toEqual({ x: 1, y: 2 });
    expect(graph.nodes[0].data).toMatchObject({ label: "In", prompt: "hi" });
  });

  it("fills providerIds from fallbackProviderId when a node carries no pin of its own", () => {
    const graph = bundleGraphToEngine(
      { nodes: [{ id: "PO", role: "PO", label: "PO" }], edges: [] },
      undefined,
      "anthropic"
    );
    expect(graph.nodes[0].data.providerIds).toEqual(["anthropic"]);
  });

  it("leaves a node's own providerIds pin untouched even with a fallback given", () => {
    const graph = bundleGraphToEngine(
      {
        nodes: [
          {
            id: "n1",
            data: { label: "Pinned", providerIds: ["openrouter"] },
          },
        ],
        edges: [],
      },
      undefined,
      "anthropic"
    );
    expect(graph.nodes[0].data.providerIds).toEqual(["openrouter"]);
  });

  it("adds no providerIds when there is neither a pin nor a fallback", () => {
    const graph = bundleGraphToEngine(
      { nodes: [{ id: "PO", role: "PO", label: "PO" }], edges: [] },
      undefined,
      undefined
    );
    expect(graph.nodes[0].data.providerIds).toEqual([]);
  });
});
