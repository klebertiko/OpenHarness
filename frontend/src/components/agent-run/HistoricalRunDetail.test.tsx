import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HistoricalRunDetail } from "./HistoricalRunDetail";

describe("HistoricalRunDetail", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("replays the persisted event log into a real transcript on open", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          id: "r1",
          harness_id: "h1",
          harness_name: "OpenHarness Agile",
          status: "complete",
          started_at: null,
          finished_at: null,
          result: {
            events: [
              {
                event: "run_start",
                data: {
                  run_id: "r1",
                  mode: "live",
                  step: false,
                  order: [{ node_id: "PO", type: "agent", label: "PO", adapter: "mock", model: "" }],
                  unreachable: [],
                },
              },
              {
                event: "node_start",
                data: { node_id: "PO", type: "agent", label: "PO", adapter: "claude", model: "" },
              },
              {
                event: "node_stream",
                data: { node_id: "PO", chunk: "Oi! Como posso ajudar?" },
              },
              {
                event: "node_done",
                data: { node_id: "PO", output: "Oi! Como posso ajudar?", tokens: 8, latency_ms: 100 },
              },
              { event: "harness_done", data: { status: "complete" } },
            ],
          },
        }),
      })
    );

    render(<HistoricalRunDetail runId="r1" />);
    fireEvent.click(screen.getByText("Show run detail"));

    await waitFor(() => expect(screen.getByText("Oi! Como posso ajudar?")).toBeTruthy());
    // The replayed segment's adapter was refreshed by node_start, same as a
    // live run — proves this goes through the real reducer, not a stub.
    expect(screen.getByText(/claude/i)).toBeTruthy();
  });

  it("shows an honest message when the run has nothing to replay", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          id: "r1",
          harness_id: "h1",
          harness_name: "OpenHarness Agile",
          status: "complete",
          started_at: null,
          finished_at: null,
          result: { events: 4 }, // the old, pre-fix shape: a count, not a list
        }),
      })
    );

    render(<HistoricalRunDetail runId="r1" />);
    fireEvent.click(screen.getByText("Show run detail"));

    await waitFor(() => expect(screen.getByText(/wasn't saved/i)).toBeTruthy());
  });

  it("shows an honest message when the run_id has no log at all (a direct/no-harness turn)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 404, text: async () => "not found" })
    );

    render(<HistoricalRunDetail runId="ghost" />);
    fireEvent.click(screen.getByText("Show run detail"));

    await waitFor(() => expect(screen.getByText(/wasn't saved/i)).toBeTruthy());
  });
});
