import { describe, expect, it } from "vitest";
import { bundleGraphToCanvas } from "./bundleGraph";

describe("OHM authoring import", () => {
  it("preserves authored data, positions, extensions and conditional wires without execution defaults", () => {
    const graph = {
      nodes: [{ id: "review", type: "gate", position: { x: -42.5, y: 310 },
        extension: { owner: "team" },
        data: { label: "Review", providerIds: ["local-pin"], model: "chosen-model",
          systemPrompt: "first line\nsecond line", secretRef: "vaultref:review",
          custom: { enabled: false, retries: 0 } } }],
      edges: [{ id: "retry", source: "review", target: "review", type: "harness",
        sourceHandle: "reject", targetHandle: "in", custom: { version: 2 },
        data: { condition: "reject", signal: "needs-revision", kind: "reject", custom: [1, 2] } }],
    };
    expect(bundleGraphToCanvas(graph)).toEqual(graph);
    expect(graph.nodes[0].data).not.toHaveProperty("prompt");
  });

  it("adapts minimal legacy graphs while retaining optional wire fields as absent", () => {
    const imported = bundleGraphToCanvas({
      nodes: [null, {}, { id: "po", role: "PO", label: "Owner" }, { id: "qa", type: "evaluator" }],
      edges: [null, {}, { source: "po", target: "qa" }],
    });
    expect(imported.nodes).toEqual([
      { id: "po", role: "PO", label: "Owner", type: "agent", position: { x: 80, y: 80 }, data: { label: "Owner", roleId: "PO" } },
      { id: "qa", type: "gate", position: { x: 260, y: 80 }, data: { label: "qa" } },
    ]);
    expect(imported.edges).toEqual([{ id: "e-0", source: "po", target: "qa" }]);
  });

  it.each([undefined, null, {}])("accepts an absent graph: %s", graph => {
    expect(bundleGraphToCanvas(graph)).toEqual({ nodes: [], edges: [] });
  });
});
