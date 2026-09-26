import type { RunState } from "./types";

/**
 * The run's total duration for the rollup header, preferring the
 * backend-measured figure — `harness_done`'s `elapsed_ms`, landed in
 * `totals.elapsedMs` by runReducer.ts — the moment it exists, over the
 * client's own ticking clock. This is the same "measured beats derived"
 * preference `totals.tokens` already gets from `harness_done.total_tokens`.
 *
 * It also makes the rollup correct for a replayed historical run
 * (HistoricalRunDetail.tsx), which has no live ticking `elapsed` at all:
 * once the replayed log reaches `harness_done`, `totals.elapsedMs` carries
 * the run's real original duration, so the rollup still shows a genuine
 * number instead of requiring every caller to fake one.
 *
 * Returns null — never a fabricated 0 — when neither source has anything
 * real to report yet.
 */
export function rollupElapsedMs(run: RunState, liveElapsed?: number): number | null {
  if (run.totals.elapsedMs > 0) return run.totals.elapsedMs;
  if (liveElapsed !== undefined) return liveElapsed;
  return null;
}

/** Where the rollup's numbers came from. `measured` = the backend's own
    `harness_done` total has landed; `estimated` = the client is still
    summing per-node events and ticking its own clock, unconfirmed. */
export type RollupSource = "measured" | "estimated";

export interface RollupTotals {
  elapsedMs: number | null;
  tokens: number;
  source: RollupSource;
}

/**
 * The rollup's numbers *with their provenance*, so the UI can say whether
 * what it shows is still a local running count or the backend-confirmed
 * total — the same distinction DeepSeek Harness's Token Meter types as
 * `baseline.kind: 'usage' | 'estimated'`, rather than a bare number that
 * silently switched sources underneath the user.
 *
 * One signal decides it, the same one `rollupElapsedMs` already keys on:
 * `harness_done` landing `totals.elapsedMs` in runReducer.ts. Until then
 * both the tokens (summed from `node_done` client-side) and the clock are
 * estimates. A run cut short by a stream `error` never gets `harness_done`
 * and therefore stays `estimated` — honest, since nothing confirmed it.
 */
export function rollupTotals(run: RunState, liveElapsed?: number): RollupTotals {
  const measured = run.totals.elapsedMs > 0;
  return {
    elapsedMs: rollupElapsedMs(run, liveElapsed),
    tokens: run.totals.tokens,
    source: measured ? "measured" : "estimated",
  };
}
