import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Transcript } from "./Transcript";
import { emptyRun } from "./runReducer";
import type { RunState, Segment } from "./types";
import { useProviderStore, type Connection } from "@/components/providers/providerStore";
import { useChatProviderStore } from "@/store/chatProviderStore";

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

function seg(overrides: Partial<Segment>): Segment {
  return {
    nodeId: "n",
    type: "agent",
    label: "Node",
    adapter: "claude",
    model: "claude-sonnet-5",
    intrinsic: false,
    state: "done",
    phase: "",
    phaseDetail: "",
    blocks: [],
    ...overrides,
  };
}

const ANTHROPIC = conn({ id: "an", label: "Anthropic" });
const OLLAMA = conn({ id: "ol", label: "Ollama local" });

/**
 * A four-node completed run: one direct-path node with no connection at all,
 * one pinned to the same connection the composer would pick by default, one
 * deliberately pinned elsewhere (the genuine mismatch), and one that errored
 * before finishing. Mirrors a real harness_done-terminated RunState rather
 * than a trivial stub — token/latency values are chosen to avoid
 * floating-point rounding boundaries in the formatters under test.
 */
function makeRun(overrides: Partial<RunState> = {}): RunState {
  const plan: Segment[] = [
    seg({ nodeId: "po", label: "PO", tokens: 1200, latencyMs: 2200, state: "done" }),
    seg({ nodeId: "dev", label: "Dev", tokens: 3400, latencyMs: 5100, state: "done", connectionId: "an" }),
    seg({ nodeId: "qa", label: "QA", tokens: 900, latencyMs: 1300, state: "done", connectionId: "ol" }),
    seg({ nodeId: "sec", label: "Security", tokens: 100, state: "error", error: "boom" }),
  ];
  return {
    ...emptyRun,
    runId: "r1",
    status: "complete",
    startedAt: 1_000,
    endedAt: 10_400,
    plan,
    totals: { tokens: 1200 + 3400 + 900 + 100, nodesRun: 4, elapsedMs: 9_400 },
    ...overrides,
  };
}

describe("Transcript — trajectory breakdown", () => {
  beforeEach(() => {
    useProviderStore.setState({ connections: [ANTHROPIC, OLLAMA] });
    useChatProviderStore.setState({ chosenId: "an" }); // composer's current default
  });

  afterEach(() => {
    cleanup();
    useProviderStore.setState({ connections: [] });
    useChatProviderStore.setState({ chosenId: null });
  });

  it("renders a rollup of real run totals, preferring the backend-measured elapsed over a stale live tick", () => {
    render(<Transcript run={makeRun()} onResolve={() => {}} elapsed={500} />);

    // totals.elapsedMs (9400ms -> "9.4s") must win over the live `elapsed`
    // prop (500ms -> "0.5s") once harness_done has reported a real figure.
    expect(screen.getByText("9.4s")).toBeTruthy();
    expect(screen.queryByText("0.5s")).toBeNull();
    expect(screen.getByText("5.6k")).toBeTruthy(); // fmtTokens(5600)
    expect(screen.getByText("4/4")).toBeTruthy();
  });

  it("shows a live ticking elapsed while the run has not yet reported a backend-measured total", () => {
    const run = makeRun({ status: "running", totals: { tokens: 900, nodesRun: 1, elapsedMs: 0 } });
    render(<Transcript run={run} onResolve={() => {}} elapsed={1_500} />);
    expect(screen.getByText("1.5s")).toBeTruthy();
  });

  it("renders a safe fallback when the backend sends an unknown node type", () => {
    const unknown = seg({
      nodeId: "future-node",
      label: "Future node",
      type: "future-type" as Segment["type"],
    });
    render(<Transcript run={makeRun({ plan: [unknown], totals: { tokens: 0, nodesRun: 1, elapsedMs: 100 } })} onResolve={() => {}} />);

    expect(screen.getAllByText("Future node")).toHaveLength(2);
    expect(screen.getByText(/future-type/)).toBeTruthy();
  });

  it("labels the rollup as measured once harness_done has confirmed the totals", () => {
    render(<Transcript run={makeRun()} onResolve={() => {}} elapsed={500} />);
    const label = screen.getByText("measured");
    expect(label.getAttribute("title")).toMatch(/backend/i);
    expect(screen.queryByText("estimated")).toBeNull();
  });

  it("labels the rollup as estimated while the client is still the only one counting", () => {
    const run = makeRun({ status: "running", totals: { tokens: 900, nodesRun: 1, elapsedMs: 0 } });
    render(<Transcript run={run} onResolve={() => {}} elapsed={1_500} />);
    const label = screen.getByText("estimated");
    expect(label.getAttribute("title")).toMatch(/local/i);
    expect(screen.queryByText("measured")).toBeNull();
  });

  it("flips the label from estimated to measured when the backend total arrives mid-view", () => {
    const running = makeRun({ status: "running", totals: { tokens: 900, nodesRun: 1, elapsedMs: 0 } });
    const { rerender } = render(<Transcript run={running} onResolve={() => {}} elapsed={1_500} />);
    expect(screen.getByText("estimated")).toBeTruthy();
    rerender(<Transcript run={makeRun()} onResolve={() => {}} elapsed={1_500} />);
    expect(screen.getByText("measured")).toBeTruthy();
    expect(screen.queryByText("estimated")).toBeNull();
  });

  it("gives each completed node its own legible latency + token row, not just the aggregate", () => {
    render(<Transcript run={makeRun()} onResolve={() => {}} elapsed={500} />);
    const table = screen.getByRole("table");

    const poRow = within(table).getByText("PO").closest("tr")!;
    const devRow = within(table).getByText("Dev").closest("tr")!;
    const qaRow = within(table).getByText("QA").closest("tr")!;

    expect(within(poRow).getByText("2.20s")).toBeTruthy();
    expect(within(poRow).getByText("1.2k")).toBeTruthy();

    expect(within(devRow).getByText("5.10s")).toBeTruthy();
    expect(within(devRow).getByText("3.4k")).toBeTruthy();

    expect(within(qaRow).getByText("1.30s")).toBeTruthy();
    expect(within(qaRow).getByText("900")).toBeTruthy();
  });

  it("shows an honest placeholder, not a fabricated latency, for a node that errored before finishing", () => {
    render(<Transcript run={makeRun()} onResolve={() => {}} elapsed={500} />);
    const table = screen.getByRole("table");
    const secRow = within(table).getByText("Security").closest("tr")!;

    expect(within(secRow).getByText("—")).toBeTruthy();
    expect(within(secRow).getByText("100")).toBeTruthy(); // tokens were still real
  });

  it("badges only the node whose pinned connection genuinely differs from the composer's current default", () => {
    render(<Transcript run={makeRun()} onResolve={() => {}} elapsed={500} />);
    const table = screen.getByRole("table");

    const qaRow = within(table).getByText("QA").closest("tr")!;
    expect(within(qaRow).getByText(/pinned/i)).toBeTruthy();
    expect(within(qaRow).getByText(/Ollama local/)).toBeTruthy();

    // Same connection as the default: no badge.
    const devRow = within(table).getByText("Dev").closest("tr")!;
    expect(within(devRow).queryByText(/pinned/i)).toBeNull();

    // No connectionId at all (the harness-off direct path): no badge.
    const poRow = within(table).getByText("PO").closest("tr")!;
    expect(within(poRow).queryByText(/pinned/i)).toBeNull();

    // Errored, no connectionId either: no badge.
    const secRow = within(table).getByText("Security").closest("tr")!;
    expect(within(secRow).queryByText(/pinned/i)).toBeNull();
  });

  it("never badges a pin when the composer itself has no resolvable default to compare against", () => {
    useProviderStore.setState({ connections: [] });
    useChatProviderStore.setState({ chosenId: null });

    render(<Transcript run={makeRun()} onResolve={() => {}} elapsed={500} />);
    const table = screen.getByRole("table");

    // QA is pinned to "ol", which is real, but there is nothing honest to
    // call "the default" right now — flagging every pin against nothing
    // configured would be noise, not signal.
    const qaRow = within(table).getByText("QA").closest("tr")!;
    expect(within(qaRow).queryByText(/pinned/i)).toBeNull();
  });

  it("renders no rollup at all for a run that has not started — no fabricated zeros", () => {
    render(<Transcript run={emptyRun} onResolve={() => {}} elapsed={0} />);
    expect(screen.queryByText("elapsed")).toBeNull();
    expect(screen.queryByText("tok")).toBeNull();
    expect(screen.queryByRole("table")).toBeNull();
  });
});
