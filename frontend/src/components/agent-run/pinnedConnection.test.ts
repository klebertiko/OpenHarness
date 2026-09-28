import { describe, expect, it } from "vitest";
import { connectionLabel, isPinnedMismatch } from "./pinnedConnection";
import type { Connection } from "@/components/providers/providerStore";

function conn(overrides: Partial<Connection>): Connection {
  return {
    id: "c",
    provider: "anthropic",
    label: "Anthropic",
    residence: "cloud",
    endpoint: "https://api.anthropic.com",
    secret: null,
    health: "live",
    detail: "",
    probes: [],
    facts: [],
    models: [],
    route: [],
    routeSort: "price",
    allowed: [],
    enabled: true,
    lastProbe: "",
    ...overrides,
  };
}

/**
 * Pins the "preservation gate" comparison this story's every piece has
 * checked: a run node's own pinned connection vs. what the chat composer
 * would use today (pickChatProvider's resolved id). Both sides real and
 * different is the only honest "mismatch".
 */
describe("isPinnedMismatch", () => {
  it("is false when the segment never resolved a connection at all", () => {
    // The harness-off /execute/direct path never sets connectionId — see
    // Segment's own doc comment in types.ts.
    expect(isPinnedMismatch(undefined, "an")).toBe(false);
  });

  it("is false when there is no resolvable composer default to compare against", () => {
    expect(isPinnedMismatch("an", null)).toBe(false);
    expect(isPinnedMismatch("an", undefined)).toBe(false);
  });

  it("is false when the node ran on exactly the composer's current default", () => {
    expect(isPinnedMismatch("an", "an")).toBe(false);
  });

  it("is true only once both sides are concrete and differ — a genuine pin", () => {
    expect(isPinnedMismatch("ol", "an")).toBe(true);
  });
});

describe("connectionLabel", () => {
  const connections = [conn({ id: "an", label: "Anthropic" }), conn({ id: "ol", label: "Ollama local" })];

  it("finds the pinned connection's human label", () => {
    expect(connectionLabel(connections, "ol")).toBe("Ollama local");
  });

  it("falls back to the raw id when the connection was since removed under Providers", () => {
    expect(connectionLabel(connections, "gone")).toBe("gone");
  });
});
