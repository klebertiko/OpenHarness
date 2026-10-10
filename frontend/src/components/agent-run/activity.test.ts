import { describe, expect, it } from "vitest";
import {
  classifyTool,
  groupActivity,
  segmentActivity,
  summarizeCalls,
  summarizeGroup,
  type ActivityGroup,
} from "./activity";
import type { Block, ToolCall } from "./types";

function call(name: string, over: Partial<ToolCall> = {}): ToolCall {
  return { callId: `${name}-${Math.random().toString(36).slice(2, 7)}`, name, args: "{}", ok: true, ...over };
}
const tool = (name: string, over: Partial<ToolCall> = {}): Block => ({ kind: "tool", call: call(name, over) });
const text = (t: string): Block => ({ kind: "text", text: t });
const reason = (t: string): Block => ({ kind: "reason", text: t });

describe("classifyTool", () => {
  it("maps known tool names onto verbs and everything else to other", () => {
    expect(classifyTool("exec")).toBe("ran");
    expect(classifyTool("run_command")).toBe("ran");
    expect(classifyTool("read")).toBe("read");
    expect(classifyTool("read_file")).toBe("read");
    expect(classifyTool("grep")).toBe("searched");
    expect(classifyTool("discover")).toBe("listed");
    expect(classifyTool("list_workspace")).toBe("listed");
    expect(classifyTool("write_file")).toBe("edited");
    expect(classifyTool("mystery_tool")).toBe("other");
  });
});

describe("groupActivity", () => {
  it("collapses consecutive tool blocks into one group", () => {
    const out = groupActivity([tool("exec"), tool("read"), tool("grep")]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ kind: "activity" });
    expect((out[0] as ActivityGroup).calls).toHaveLength(3);
  });

  it("leaves a lone tool call untouched", () => {
    const b = tool("exec");
    expect(groupActivity([b])).toEqual([b]);
  });

  it("never crosses a text or reasoning block", () => {
    const out = groupActivity([tool("a"), tool("b"), text("hi"), tool("c"), reason("hm"), tool("d"), tool("e")]);
    expect(out.map((x) => (x.kind === "activity" ? `g${x.calls.length}` : x.kind))).toEqual([
      "g2",
      "text",
      "tool",
      "reason",
      "g2",
    ]);
  });

  it("keeps non-tool blocks and order, and handles an empty list", () => {
    expect(groupActivity([])).toEqual([]);
    const t = text("only");
    expect(groupActivity([t])).toEqual([t]);
  });
});

describe("summarizeCalls / summarizeGroup", () => {
  it("counts by verb in a fixed order with singular/plural forms", () => {
    const s = summarizeCalls([
      call("exec"), call("exec"), call("exec"), call("read"), call("read"), call("grep"),
    ]);
    expect(s.label).toBe("Ran 3 commands · Read 2 files · Searched 1 time");
    expect(s.counts).toEqual({ ran: 3, read: 2, searched: 1 });
    expect(s.total).toBe(6);
    expect(s.running).toBe(false);
    expect(s.failed).toBe(0);
  });

  it("falls into a generic 'Used N tools' for unknown tools, and 'other' when mixed", () => {
    expect(summarizeCalls([call("zz"), call("yy"), call("xx")]).label).toBe("Used 3 tools");
    expect(summarizeCalls([call("zz")]).label).toBe("Used 1 tool");
    expect(summarizeCalls([call("exec"), call("zz"), call("yy")]).label).toBe("Ran 1 command · Used 2 other tools");
  });

  it("reports a failure count in the label (ok=false)", () => {
    const s = summarizeCalls([call("exec"), call("exec", { ok: false }), call("read", { ok: false })]);
    expect(s.failed).toBe(2);
    expect(s.denied).toBe(0);
    expect(s.label).toBe("Ran 2 commands · Read 1 file · 2 failed");
  });

  it("counts a denial separately: the user's decision, not a failure", () => {
    const s = summarizeCalls([
      call("exec"),
      call("exec", { ok: false, denied: { reason: "rejected", note: "" } }),
      call("read", { ok: false }),
    ]);
    expect(s.failed).toBe(1);
    expect(s.denied).toBe(1);
    expect(s.label).toBe("Ran 2 commands · Read 1 file · 1 failed · 1 denied");
    expect(summarizeCalls([call("exec", { denied: { reason: "policy", note: "" } })]).failed).toBe(0);
  });

  it("is running while any call has no result yet, and names the current call", () => {
    const s = summarizeCalls([
      call("read"),
      call("exec", { ok: undefined, argv: ["npm", "test"] }),
    ]);
    expect(s.running).toBe(true);
    expect(s.current).toBe("Running npm test…");
    expect(summarizeCalls([call("exec"), call("exec")]).current).toBeNull();
  });

  it("flags an unresolved approval and prefers it as the current call", () => {
    const pending = call("exec", {
      ok: undefined,
      argv: ["rm", "-rf", "x"],
      approval: { reason: "exec", risk: "high", riskHints: [] },
    });
    const s = summarizeCalls([pending, call("read", { ok: undefined, path: "a.ts" })]);
    expect(s.awaitingApproval).toBe(true);
    expect(s.current).toBe("Waiting for approval: rm -rf x");

    const decided = call("exec", {
      approval: { reason: "exec", risk: "normal", riskHints: [], decision: "approve" },
    });
    expect(summarizeCalls([decided]).awaitingApproval).toBe(false);
  });

  it("summarizeGroup delegates to the group's calls", () => {
    const g: ActivityGroup = { kind: "activity", calls: [call("exec"), call("read")] };
    expect(summarizeGroup(g)).toEqual(summarizeCalls(g.calls));
  });
});

describe("segmentActivity (step header summary)", () => {
  it("is null when a step has no tools or only one activity item", () => {
    expect(segmentActivity([text("x")])).toBeNull();
    expect(segmentActivity([tool("exec")])).toBeNull();
    expect(segmentActivity([tool("exec"), tool("read")])).toBeNull(); // one group: the group line says it all
  });

  it("summarises the whole step across several groups", () => {
    const s = segmentActivity([
      tool("exec"), tool("exec"), text("x"), tool("read"), tool("read"), tool("read"),
    ]);
    expect(s?.label).toBe("Ran 2 commands · Read 3 files");
  });

  it("is null for a single item even when it failed (the row already shows it)", () => {
    expect(segmentActivity([tool("exec", { ok: false })])).toBeNull();
    expect(segmentActivity([tool("exec", { ok: false }), tool("read")])).toBeNull();
  });

  it("surfaces failures across several items", () => {
    const s = segmentActivity([tool("exec", { ok: false }), text("x"), tool("read")]);
    expect(s?.failed).toBe(1);
    expect(s?.label).toBe("Ran 1 command · Read 1 file · 1 failed");
  });
});
