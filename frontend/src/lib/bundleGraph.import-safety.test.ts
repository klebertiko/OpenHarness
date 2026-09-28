import { expect, it } from "vitest";
import { bundleGraphToCanvas } from "./bundleGraph";

it("does not load deprecated inline API keys into the authoring canvas", () => {
  const node = { id: "agent", type: "agent", position: { x: 0, y: 0 },
    data: { label: "Agent", apiKey: "synthetic-test-key", secretRef: "vaultref:agent" } };
  const imported = bundleGraphToCanvas({ nodes: [node], edges: [] });
  expect(imported.nodes[0].data).not.toHaveProperty("apiKey");
  expect(imported.nodes[0].data.secretRef).toBe("vaultref:agent");
  expect(node.data.apiKey).toBe("synthetic-test-key");
});

it("treats prototype property names as unknown node types", () => {
  const imported = bundleGraphToCanvas({ nodes: [{ id: "external", type: "constructor", data: { label: "External" } }] });
  expect(imported.nodes[0].type).toBe("agent");
});
