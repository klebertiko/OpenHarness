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
 * Round 2 of the trajectory-breakdown gauntlet: the rollup must say *which
 * source* produced the number on screen, not just pick the better one
 * silently. Bar: DeepSeek Harness's Token Meter, which types every
 * measurement as `baseline.kind: 'usage' | 'estimated'`.
 */
describe("rollupTotals", () => {
  it("reports the totals as estimated while only the client has been counting", () => {
    const run: RunState = {
      ...emptyRun,
      status: "running",
      totals: { tokens: 900, nodesRun: 1, elapsedMs: 0 },
    };
    expect(rollupTotals(run, 1500)).toEqual({ elapsedMs: 1500, tokens: 900, source: "estimated" });
  });

  it("flips to measured the moment harness_done lands the backend's own total", () => {
    const run: RunState = {
      ...emptyRun,
      status: "complete",
      totals: { tokens: 5600, nodesRun: 4, elapsedMs: 9400 },
    };
    expect(rollupTotals(run, 999)).toEqual({ elapsedMs: 9400, tokens: 5600, source: "measured" });
  });

  it("keeps the no-data contract: null elapsed, never a fabricated zero, and still only estimated", () => {
    expect(rollupTotals(emptyRun, undefined)).toEqual({ elapsedMs: null, tokens: 0, source: "estimated" });
  });
});
