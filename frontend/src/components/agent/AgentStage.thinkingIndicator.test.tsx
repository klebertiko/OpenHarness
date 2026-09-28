import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { useHarnessSessionStore } from "@/store/harnessSessionStore";
import { AgentStage } from "./AgentStage";

/**
 * ThinkingStatus itself has no notion of "segment" (see ThinkingStatus.test.tsx
 * — it renders exactly whatever `tokens` number it's handed, nothing more).
 * The guarantee that the number handed to it is specifically the run-wide
 * `run.totals.tokens`, and never one segment's own `tokens` field, is a
 * wiring fact that only exists at this call site inside AgentStage — so it
 * can only be pinned here, not in ThinkingStatus's own suite.
 */
const runTotalTokens = 9999; // -> "10.0k" via the shared tokens() formatter
const segmentTokensThatMustNotLeakIn = [1500, 2300]; // -> "1.5k" / "2.3k" — must never appear

function fmt(n: number) {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

const liveRun = {
  runId: "run-1",
  status: "running",
  mode: "chat",
  step: false,
  plan: [
    {
      nodeId: "n1",
      type: "agent",
      label: "Step 1",
      adapter: "anthropic",
      model: "claude",
      intrinsic: true,
      state: "done",
      phase: "",
      phaseDetail: "",
      blocks: [],
      tokens: segmentTokensThatMustNotLeakIn[0],
    },
    {
      nodeId: "n2",
      type: "agent",
      label: "Step 2",
      adapter: "anthropic",
      model: "claude",
      intrinsic: true,
      state: "running",
      phase: "",
      phaseDetail: "",
      blocks: [],
      tokens: segmentTokensThatMustNotLeakIn[1],
    },
  ],
  cursor: 1,
  totals: { tokens: runTotalTokens, nodesRun: 1, elapsedMs: 5000 },
  startedAt: Date.now() - 5000,
  endedAt: null,
  awaitingStep: null,
  steers: [],
  notices: [],
};

// Keep the sidecar and heavy siblings out of this seam test — same isolation
// AgentStage.test.tsx already uses for this component.
vi.mock("@/components/agent-run/useRunStream", () => ({
  useRunStream: () => ({
    run: liveRun,
    elapsed: 5000,
    live: true,
    reset: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
    advance: vi.fn(),
    resolveGate: vi.fn(),
  }),
}));

vi.mock("@/components/agent/HarnessBar", () => ({
  HarnessBar: () => <div data-testid="harness-bar" />,
}));
vi.mock("@/components/agent/ChatProviderPicker", () => ({
  ChatProviderPicker: () => <div data-testid="chat-provider-picker" />,
}));
vi.mock("@/components/agent/WorkspacePicker", () => ({
  WorkspacePicker: () => <div data-testid="workspace-picker" />,
}));
vi.mock("@/components/agent-run/Gate", () => ({
  Gate: () => null,
}));
vi.mock("@/components/agent-run/Transcript", () => ({
  Transcript: () => null,
}));

describe("AgentStage thinking indicator wiring", () => {
  beforeEach(() => {
    useHarnessSessionStore.setState({
      hydrated: true,
      enabled: false,
      activeBundle: null,
      hydrate: async () => undefined,
    });
    // AgentStage's bottom-of-thread effect calls scrollIntoView once the
    // message list (not the empty-state welcome) is on screen; jsdom has no
    // implementation of it.
    HTMLElement.prototype.scrollIntoView = vi.fn();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders the run-wide token total through ThinkingStatus, never a segment's own count", () => {
    render(<AgentStage />);

    // Plain substring checks, not a trailing-\b regex: ThinkingStatus's own
    // "detail" paragraph (a real sibling AgentStage always supplies) butts
    // right up against this text with no separator in raw .textContent, so
    // "...10.0k tok" + "Waiting on the provider." reads as one glued word to
    // \b — a DOM-flattening artifact, not a real adjacency a user or screen
    // reader would ever see (they render as separate block-level lines).
    const text = screen.getByRole("status").textContent ?? "";
    expect(text).toContain(`${fmt(runTotalTokens)} tok`);
    for (const leaked of segmentTokensThatMustNotLeakIn) {
      expect(text).not.toContain(`${fmt(leaked)} tok`);
    }
  });

  it("passes the real run clock through as elapsed, not a frozen 0s", () => {
    render(<AgentStage />);

    const text = screen.getByRole("status").textContent ?? "";
    expect(text).toMatch(/\b5s\b/);
  });
});
