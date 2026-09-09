import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  composeBundleFromCanvas,
  fetchDefault,
  isOHarnessBundle,
  mockBundle,
  validateBundle,
  type OHarnessBundle,
} from "./bundlesApi";

const sample: OHarnessBundle = {
  schemaVersion: "1.0.0",
  manifest: {
    id: "hello",
    name: "Hello",
    version: "0.1.0",
    description: "min",
    license: "MIT",
    tags: [],
  },
  graph: { nodes: [], edges: [] },
  content: {
    prompts: {},
    agents: {},
    skills: {},
    hooks: {},
    commands: {},
    scripts: {},
  },
  runtime: { preferred: "api", cli: null, env: [], secrets: [] },
  validation: { mockProfile: "default" },
};

describe("bundlesApi", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("fetchDefault GETs /bundles/default", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => sample,
      })
    );

    const bundle = await fetchDefault();
    expect(fetch).toHaveBeenCalledWith("/bundles/default", { cache: "no-store" });
    expect(bundle.manifest.id).toBe("hello");
  });

  it("validateBundle POSTs /bundles/validate", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ ok: true, errors: [] }),
      })
    );

    const result = await validateBundle(sample);
    expect(fetch).toHaveBeenCalledWith("/bundles/validate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(sample),
    });
    expect(result.ok).toBe(true);
  });

  it("mockBundle POSTs /bundles/mock", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          ok: true,
          steps: [{ nodeId: "a", role: "llm", status: "planned", note: "" }],
        }),
      })
    );

    const result = await mockBundle(sample);
    expect(fetch).toHaveBeenCalledWith(
      "/bundles/mock",
      expect.objectContaining({ method: "POST" })
    );
    expect(result.steps).toHaveLength(1);
  });

  it("composeBundleFromCanvas overlays canvas graph on base content", () => {
    const composed = composeBundleFromCanvas(sample, {
      nodes: [{ id: "n1", type: "llm", data: { label: "Writer" } }],
      edges: [{ id: "e1", source: "n1", target: "n1" }],
      harnessMeta: { name: "Studio Draft", description: "from canvas" },
    });

    expect(composed.content).toEqual(sample.content);
    expect(composed.manifest.name).toBe("Studio Draft");
    expect(composed.graph.nodes).toEqual([
      { id: "n1", role: "llm", label: "Writer" },
    ]);
    expect(composed.graph.edges).toEqual([
      { id: "e1", source: "n1", target: "n1" },
    ]);
  });

  it("isOHarnessBundle requires schemaVersion + manifest.id", () => {
    expect(isOHarnessBundle(sample)).toBe(true);
    expect(isOHarnessBundle({ manifest: { id: "x" } })).toBe(false);
    expect(isOHarnessBundle(null)).toBe(false);
  });
});
