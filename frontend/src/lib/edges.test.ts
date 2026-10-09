import { describe, expect, it } from "vitest";
import { edgeForConnection } from "./edges";
import type { HarnessNode } from "./types";

const node = (type: HarnessNode["type"], id = "n"): HarnessNode => ({ id, type, position: { x: 0, y: 0 }, data: { label: id } });

describe("edgeForConnection", () => {
  it("gives a hitl reject wire the reject kind and label", () => {
    const e = edgeForConnection(node("hitl", "h"), { source: "h", target: "a", sourceHandle: "reject", targetHandle: "in" });
    expect(e).toMatchObject({ id: "e-h-reject-a-in", type: "harness", data: { kind: "reject", label: "reject" } });
  });

  it("gives an agent out wire the flow kind and no label", () => {
    const e = edgeForConnection(node("agent", "a"), { source: "a", target: "g", sourceHandle: "out", targetHandle: "in" });
    expect(e.data).toEqual({ kind: "flow", label: undefined });
  });

  it("normalises missing handles and uses the accept tone for pass", () => {
    const e = edgeForConnection(node("gate", "g"), { source: "g", target: "h", sourceHandle: null, targetHandle: null });
    expect(e).toMatchObject({ id: "e-g-pass-h-in", sourceHandle: "pass", targetHandle: "in", data: { kind: "accept", label: "pass" } });
  });

  it("copes with an unknown source node", () => {
    const e = edgeForConnection(undefined, { source: "x", target: "y", sourceHandle: "out", targetHandle: "in" });
    expect(e).toMatchObject({ id: "e-x-out-y-in", data: { kind: "flow" } });
  });
});
