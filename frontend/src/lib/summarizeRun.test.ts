import { describe, expect, it } from "vitest";
import { summarizeRunOutput } from "./summarizeRun";
import type { RunState } from "@/components/agent-run/types";

type Segment = RunState["plan"][number];

const seg = (over: Partial<Segment> = {}): Segment =>
  ({ nodeId: "n", label: "N", state: "done", phase: null, blocks: [], ...over }) as unknown as Segment;

const run = (plan: Segment[], status: RunState["status"] = "complete"): RunState =>
  ({ runId: "r", status, plan } as unknown as RunState);

describe("summarizeRunOutput", () => {
  it("collapses a mock run that repeats the same line from every node to one line", () => {
    const line = "Produced a response for this node from the upstream context.";
    const plan = ["PO", "SM", "BE", "QA"].map((label) => seg({ label, output: line }));
    expect(summarizeRunOutput(run(plan))).toBe(line);
  });

  it("returns the final distinct answer and notes how many steps ran", () => {
    const out = summarizeRunOutput(
      run([seg({ label: "Plan", output: "step one" }), seg({ label: "Do", output: "step two" })]),
    );
    expect(out.startsWith("step two")).toBe(true);
    expect(out).toMatch(/2 steps ran/);
  });

  it("surfaces an error when nothing else was produced", () => {
    expect(summarizeRunOutput(run([seg({ label: "QA", error: "assertion failed" })], "error"))).toBe(
      "Run failed.\n\nQA: assertion failed",
    );
  });

  it("is honest when a completed run said nothing", () => {
    expect(summarizeRunOutput(run([seg()], "complete"))).toBe("The run finished without a text answer.");
  });

  it("returns empty while a run is still going with no text yet", () => {
    expect(summarizeRunOutput(run([seg()], "running"))).toBe("");
  });

  it("does not repeat a finished node's own answer — output IS the assembled blocks, not a second thing", () => {
    // Surfaced live, 2026-09-11: a single-node chat run's reply read the
    // same sentence twice. `output` (from node_done) and `blocks` (from
    // node_stream, which fed the same output as it streamed in) both held
    // the text, and both used to get concatenated.
    const text = "Oi! Como posso ajudar você hoje?";
    const plan = [seg({ label: "Reply", output: text, blocks: [{ kind: "text", text }] })];
    expect(summarizeRunOutput(run(plan))).toBe(text);
  });
});
