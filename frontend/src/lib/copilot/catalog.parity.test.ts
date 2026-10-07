import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ASSISTABLE, CATALOG_TYPES, EDITABLE, LIMITS, buildCatalog } from "./catalog";

const json = JSON.parse(
  readFileSync(path.resolve(__dirname, "../../../../backend/studio_copilot/catalog.json"), "utf8"),
) as Record<string, unknown>;

describe("catalog parity with backend/studio_copilot/catalog.json", () => {
  it("buildCatalog() deep-equals the frozen JSON without _source", () => {
    const { _source, ...frozen } = json;
    expect(_source).toBeTypeOf("string");
    expect(buildCatalog()).toEqual(frozen);
  });

  it("never lists decision and exposes exactly the six authorable types", () => {
    expect(CATALOG_TYPES).toEqual(["agent", "gate", "hitl", "skill", "mcp", "tool"]);
    expect(buildCatalog().nodes.map((n) => n.type)).not.toContain("decision");
  });

  it("no credential, provider or execution field is editable", () => {
    const forbidden = ["providerIds", "providerRoutes", "adapter", "model", "endpoint", "secretRef", "apiKey", "mcpCommand", "mcpUrl", "connectorIds", "toolKind", "tokenLimit", "maxTokens", "temperature"];
    for (const type of CATALOG_TYPES) {
      for (const key of forbidden) expect(EDITABLE[type]).not.toContain(key);
    }
  });

  it("assistable fields are a subset of editable fields", () => {
    for (const [type, fields] of Object.entries(ASSISTABLE)) {
      for (const f of fields!) expect(EDITABLE[type as keyof typeof EDITABLE]).toContain(f);
    }
  });

  it("LIMITS match the JSON limits", () => {
    expect(LIMITS).toEqual(json.limits);
  });
});
