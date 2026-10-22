import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { RunLogDetail } from "@/lib/runsApi";
import { RunEvidence } from "./RunEvidence";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("shows partial coverage and retrieves a saved artifact version", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ content: "saved answer" }) }));
  const detail: RunLogDetail = {
    id: "r1", harnessId: "h", harnessName: "Harness", source: "harness", status: "interrupted",
    startedAt: null, finishedAt: null, result: {}, coverage: "partial", lastSequence: 3,
    artifacts: [{ id: "a1", run_id: "r1", event_sequence: 3, kind: "node_output", name: "Agent output",
      version: 2, media_type: "text/plain", sha256: "hash" }],
  };
  render(<RunEvidence detail={detail} />);
  expect(screen.getByText(/Partial history/)).toBeTruthy();
  expect(screen.getByText(/execution did not resume/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Agent output · v2" }));
  expect(await screen.findByText("saved answer")).toBeTruthy();
  expect(fetch).toHaveBeenCalledWith("http://127.0.0.1:8000/execute/logs/r1/artifacts/a1", { cache: "no-store" });
});

it("labels legacy coverage without inventing completeness", () => {
  const detail: RunLogDetail = {
    id: "old", harnessId: "h", harnessName: "Harness", source: "harness", status: "complete",
    startedAt: null, finishedAt: null, result: {}, coverage: "legacy_unknown", lastSequence: null, artifacts: [],
  };
  render(<RunEvidence detail={detail} />);
  expect(screen.getByText(/capture coverage is unknown/)).toBeTruthy();
});
