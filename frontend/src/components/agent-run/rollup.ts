import type { RunState } from "./types";

/** A run that has stopped changing: nothing left that could still tick or be counted. */
function isFinished(run: RunState): boolean {
  return run.status === "complete" || run.status === "error" || run.status === "stopped";
}

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
 * real to report. (`elapsed_ms: 0` on the wire means "not captured": a run
 * that really finished in under a millisecond does not exist.)
 */
export function rollupElapsedMs(run: RunState, liveElapsed?: number): number | null {
  if (run.totals.elapsedMs > 0) return run.totals.elapsedMs;
  if (liveElapsed !== undefined && liveElapsed > 0) return liveElapsed;
  return null;
}

/**
 * What the duration figure is:
 * - `running`    — the run is still going and the clock is ticking.
 * - `recorded`   — a real duration exists (backend-measured, or the client's
 *                  own clock for a run it watched end to end).
 * - `unrecorded` — the run is over (or its log never reached the end) and no
 *                  duration was ever captured. Shown as such, not as "—" or 0.
 */
export type ElapsedState = "running" | "recorded" | "unrecorded";

/**
 * Where the token count came from — independent of the duration:
 * - `live`        — the run is still going; the count is still moving.
 * - `measured`    — finished, and the backend said every count was reported
 *                   by the provider (`tokens_estimated: false`).
 * - `estimated`   — finished, and at least one count was approximated from
 *                   output length (`tokens_estimated: true`). The only case
 *                   that may be labelled "estimated".
 * - `unconfirmed` — finished, but the log carries no provenance (written
 *                   before the backend stated it); claimed neither way.
 */
export type TokenSource = "live" | "measured" | "estimated" | "unconfirmed";

export interface RollupTotals {
  elapsedMs: number | null;
  elapsedState: ElapsedState;
  tokens: number;
  tokenSource: TokenSource;
}

/**
 * The rollup's numbers *with their provenance*, so the UI says what kind of
 * number it is showing rather than a bare value — the same distinction
 * DeepSeek Harness's Token Meter types as `baseline.kind: 'usage' |
 * 'estimated'`. Duration and token provenance are separate questions and are
 * answered separately: a run can have a real token count and no captured
 * duration, and must not be called "estimated" because of the latter.
 */
export function rollupTotals(run: RunState, liveElapsed?: number): RollupTotals {
  // Only a run someone is actually watching (a ticking clock was handed in)
  // is "in progress". A replayed log that never reached `harness_done` is an
  // interrupted run, not a running one.
  const watching = !isFinished(run) && run.status !== "idle" && liveElapsed !== undefined;
  const elapsed = rollupElapsedMs(run, liveElapsed);

  let elapsedMs = elapsed;
  let elapsedState: ElapsedState;
  if (watching) {
    elapsedMs = elapsed ?? liveElapsed ?? 0;
    elapsedState = "running";
  } else {
    elapsedState = elapsed === null ? "unrecorded" : "recorded";
  }

  let tokenSource: TokenSource;
  if (watching) tokenSource = "live";
  else if (isFinished(run) && run.totals.tokensEstimated === true) tokenSource = "estimated";
  else if (isFinished(run) && run.totals.tokensEstimated === false) tokenSource = "measured";
  else tokenSource = "unconfirmed";

  return { elapsedMs, elapsedState, tokens: run.totals.tokens, tokenSource };
}
