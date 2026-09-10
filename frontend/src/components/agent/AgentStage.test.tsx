import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { useHarnessSessionStore } from "@/store/harnessSessionStore";

import { AgentStage } from "./AgentStage";

vi.mock("@/components/agent-run/useRunStream", () => ({
  useRunStream: () => ({
    run: { runId: null, status: "idle" },
    elapsed: 0,
    live: false,
    start: vi.fn(),
    stop: vi.fn(),
    advance: vi.fn(),
    resolveGate: vi.fn(),
  }),
}));

vi.mock("@/components/agent/HarnessBar", () => ({
  HarnessBar: () => <div data-testid="harness-bar" />,
}));

vi.mock("@/components/agent-run/RunControls", () => ({
  RunControls: () => null,
}));

vi.mock("@/components/agent-run/RunLadder", () => ({
  RunLadder: () => null,
}));

vi.mock("@/components/agent-run/Transcript", () => ({
  Transcript: () => null,
}));

/**
 * Chat-only stage: Cowork / Automations / Git tabs must not appear (palette Task 5).
 */
describe("AgentStage chat-only surface", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    useHarnessSessionStore.setState({
      hydrated: true,
      enabled: true,
      activeBundle: null,
      hydrate: async () => undefined,
    });
  });

  it("does not expose Cowork / Automations / Git tablist", () => {
    render(<AgentStage />);

    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.queryByRole("tab", { name: /^chat$/i })).toBeNull();
    expect(screen.queryByRole("tab", { name: /^cowork$/i })).toBeNull();
    expect(screen.queryByRole("tab", { name: /^automations$/i })).toBeNull();
    expect(screen.queryByRole("tab", { name: /^git$/i })).toBeNull();
    expect(screen.queryByText("Cowork")).toBeNull();
    expect(screen.queryByText("Automations")).toBeNull();
    expect(screen.queryByText("Git")).toBeNull();
  });
});
