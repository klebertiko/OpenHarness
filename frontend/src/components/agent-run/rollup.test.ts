import { describe, expect, it } from "vitest";
import { rollupElapsedMs, rollupTotals } from "./rollup";
import { emptyRun } from "./runReducer";
import type { RunState } from "./types";

/**
 * The rollup's total-elapsed figure must prefer the backend-measured
 * `harness_done.elapsed_ms` (landed in `totals.elapsedMs` by runReducer.ts)
 * over the client's own ticking clock the instant it exists — same
 * "measured beats derived" preference `totals.tokens` already gets. This
 * is also what lets HistoricalRunDetail.tsx (no live ticking elapsed at
 * all) show a real number once its replay reaches harness_done.
 */
describe("rollupElapsedMs", () => {
  it("prefers the backend-measured harness_done figure once it exists", () => {
    const run: RunState = { ...emptyRun, totals: { ...emptyRun.totals, elapsedMs: 4321 } };
    expect(rollupElapsedMs(run, 999)).toBe(4321);
  });

  it("falls back to the live ticking clock mid-run, before harness_done has reported", () => {
    const run: RunState = { ...emptyRun, totals: { ...emptyRun.totals, elapsedMs: 0 } };
    expect(rollupElapsedMs(run, 1500)).toBe(1500);
  });

  it("is honest about having nothing to show yet, rather than fabricating a number", () => {
    const run: RunState = { ...emptyRun, totals: { ...emptyRun.totals, elapsedMs: 0 } };
    expect(rollupElapsedMs(run, undefined)).toBeNull();
  });
});

/**
 * The rollup must say, per figure, *what kind of number* it is showing —
 * duration and token count have independent provenance. A finished run whose
 * backend never captured a duration is "unrecorded", never "—" or a fake 0;
 * and "estimated" is reserved for token counts that really were estimated.
 */
describe("rollupTotals", () => {
  it("while running: ticking clock, tokens still being counted", () => {
    const run: RunState = {
      ...emptyRun,
      status: "running",
      totals: { tokens: 900, nodesRun: 1, elapsedMs: 0 },
    };
    expect(rollupTotals(run, 1500)).toEqual({
      elapsedMs: 1500,
      elapsedState: "running",
      tokens: 900,
      tokenSource: "live",
    });
  });

  it("finished with real metrics: backend duration wins and real token counts are measured", () => {
    const run: RunState = {
      ...emptyRun,
      status: "complete",
      totals: { tokens: 5600, nodesRun: 4, elapsedMs: 9400, tokensEstimated: false },
    };
    expect(rollupTotals(run, 999)).toEqual({
      elapsedMs: 9400,
      elapsedState: "recorded",
      tokens: 5600,
      tokenSource: "measured",
    });
  });

  it("finished with estimated tokens: only then is it labelled estimated", () => {
    const run: RunState = {
      ...emptyRun,
      status: "complete",
      totals: { tokens: 19, nodesRun: 1, elapsedMs: 700, tokensEstimated: true },
    };
    expect(rollupTotals(run, undefined).tokenSource).toBe("estimated");
  });

  it("finished without a captured duration: unrecorded, never a fabricated zero or a bare dash", () => {
    const run: RunState = {
      ...emptyRun,
      status: "complete",
      totals: { tokens: 19, nodesRun: 1, elapsedMs: 0, tokensEstimated: false },
    };
    expect(rollupTotals(run, undefined)).toEqual({
      elapsedMs: null,
      elapsedState: "unrecorded",
      tokens: 19,
      tokenSource: "measured",
    });
  });

  it("finished with no backend duration but a live client clock: that real client-side figure is used", () => {
    const run: RunState = {
      ...emptyRun,
      status: "complete",
      totals: { tokens: 19, nodesRun: 1, elapsedMs: 0, tokensEstimated: false },
    };
    const totals = rollupTotals(run, 1234);
    expect(totals.elapsedMs).toBe(1234);
    expect(totals.elapsedState).toBe("recorded");
  });

  it("finished by a log that predates token provenance: unconfirmed, not claimed either way", () => {
    const run: RunState = {
      ...emptyRun,
      status: "complete",
      totals: { tokens: 19, nodesRun: 1, elapsedMs: 700 },
    };
    expect(rollupTotals(run, undefined).tokenSource).toBe("unconfirmed");
  });

  it("keeps the no-data contract: null elapsed, never a fabricated zero", () => {
    expect(rollupTotals(emptyRun, undefined).elapsedMs).toBeNull();
  });
});
