import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Transcript } from "./Transcript";
import { emptyRun } from "./runReducer";
import type { Block, RunState, Segment, ToolCall } from "./types";
import { useProviderStore } from "@/components/providers/providerStore";
import { useChatProviderStore } from "@/store/chatProviderStore";

let n = 0;
function call(name: string, over: Partial<ToolCall> = {}): ToolCall {
  n += 1;
  return { callId: `c${n}`, name, args: `arg-${name}-${n}`, ok: true, result: "ok", ...over };
}
const tool = (name: string, over: Partial<ToolCall> = {}): Block => ({ kind: "tool", call: call(name, over) });

function seg(nodeId: string, blocks: Block[], over: Partial<Segment> = {}): Segment {
  return {
    nodeId,
    type: "agent",
    label: nodeId,
    adapter: "claude",
    model: "m",
    intrinsic: false,
    state: "done",
    phase: "",
    phaseDetail: "",
    blocks,
    ...over,
  };
}

function run(plan: Segment[], over: Partial<RunState> = {}): RunState {
  return { ...emptyRun, runId: "r1", status: "complete", startedAt: 1, plan, ...over };
}

const noop = () => {};
const renderRun = (r: RunState) => render(<Transcript run={r} onResolve={noop} />);

describe("Transcript — activity summary", () => {
  beforeEach(() => {
    useProviderStore.setState({ connections: [] });
    useChatProviderStore.setState({ chosenId: null });
  });
  afterEach(cleanup);

  it("collapses a finished group to one summary line and expands on click", () => {
    renderRun(run([seg("dev", [tool("exec"), tool("exec"), tool("read")])]));
    const btn = screen.getByRole("button", { name: /Ran 2 commands · Read 1 file/ });
    expect(btn.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("exec")).toBeNull();

    fireEvent.click(btn);
    expect(btn.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getAllByText("exec")).toHaveLength(2);

    fireEvent.click(btn);
    expect(btn.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("exec")).toBeNull();
  });

  it("renders a single tool call as before, without a group", () => {
    renderRun(run([seg("dev", [tool("exec")])]));
    expect(screen.getByText("exec")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Ran 1 command/ })).toBeNull();
  });

  it("forces the group open while a call awaits approval, and cannot be collapsed", () => {
    const pending = tool("exec", {
      ok: undefined,
      result: undefined,
      origin: "model",
      argv: ["npm", "test"],
      approval: { reason: "exec", risk: "normal", riskHints: [] },
    });
    renderRun(run([seg("dev", [tool("read"), pending], { state: "gate" })], { status: "running" }));
    const btn = screen.getByRole("button", { name: /Waiting for approval: npm test/ });
    expect(btn.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("button", { name: "Aprovar" })).toBeTruthy();
    fireEvent.click(btn);
    expect(btn.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("button", { name: "Aprovar" })).toBeTruthy();
  });

  it("defaults open and shows a failure count when a call failed", () => {
    renderRun(run([seg("dev", [tool("exec"), tool("exec", { ok: false, result: "exit 1" })])]));
    const btn = screen.getByRole("button", { name: /Ran 2 commands · 1 failed/ });
    expect(btn.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getAllByText("exec")).toHaveLength(2);
  });

  it("shows the live current call while running, collapsed", () => {
    const live = tool("exec", { ok: undefined, result: undefined, argv: ["npm", "test"] });
    renderRun(run([seg("dev", [tool("read"), live], { state: "running" })], { status: "running" }));
    const btn = screen.getByRole("button", { name: /Running npm test…/ });
    expect(btn.getAttribute("aria-expanded")).toBe("false");
  });

  it("never groups across steps, and each step header gets its own summary", () => {
    renderRun(
      run([
        seg("one", [tool("exec"), tool("exec"), { kind: "text", text: "mid" }, tool("read"), tool("read")]),
        seg("two", [tool("exec"), tool("grep")]),
      ]),
    );
    const labels = screen.getAllByRole("button", { expanded: false }).map((b) => b.textContent ?? "");
    expect(labels).toHaveLength(3);
    expect(labels[0]).toContain("Ran 2 commands");
    expect(labels[1]).toContain("Read 2 files");
    // step two's calls are their own group, not merged with step one's tail
    expect(labels[2]).toContain("Ran 1 command · Searched 1 time");
    expect(screen.getByLabelText("one activity").textContent).toBe("Ran 2 commands · Read 2 files");
    expect(screen.queryByLabelText("two activity")).toBeNull();
  });
});

describe("Transcript — step header summary", () => {
  beforeEach(() => {
    useProviderStore.setState({ connections: [] });
    useChatProviderStore.setState({ chosenId: null });
  });
  afterEach(cleanup);

  it("summarises the whole step in its header when it has several activity items", () => {
    renderRun(
      run([
        seg("one", [tool("exec"), tool("exec"), { kind: "text", text: "mid" }, tool("read"), tool("read"), tool("read")]),
      ]),
    );
    expect(screen.getByLabelText("one activity").textContent).toBe("Ran 2 commands · Read 3 files");
  });

  it("does not echo a header summary when the step is a single group", () => {
    renderRun(run([seg("one", [tool("exec"), tool("read")])]));
    expect(screen.queryByLabelText("one activity")).toBeNull();
  });
});
