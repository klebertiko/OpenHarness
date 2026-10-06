"use client";

import { useId, useState } from "react";
import { runsApi } from "@/lib/runsApi";
import { RunDetailRegion, RunDetailToggle } from "./RunDetailToggle";
import { Transcript } from "./Transcript";
import { emptyRun, runReducer } from "./runReducer";
import type { RunState } from "./types";

/**
 * "Show run detail" for the run behind a chat message — the single control
 * for that run.
 *
 * Normally the live `RunState` in `useRunStream` is in-memory only and is gone
 * the moment the page reloads, even though the chat bubble's own summary text
 * survives (it's saved onto the thread message). So this rebuilds an
 * equivalent `RunState` by replaying the real event log the sidecar persisted
 * (`GET /execute/logs/{runId}`, `ExecutionLog.result_json`) through the same
 * reducer the live view uses, so the two render identically.
 *
 * For the run that *just* finished, that state is still in memory: the caller
 * hands it in as `run` and this never round-trips to the sidecar. That is what
 * lets the stage drop its own toggle once the run is saved on a message —
 * one control per run, not a message toggle plus an orphan below it.
 */
export function HistoricalRunDetail({
  runId,
  run: memoryRun,
  elapsed,
  defaultOpen = false,
}: {
  runId: string;
  /** The finished run still held in memory, when this message is its own. */
  run?: RunState;
  /** The client-observed clock for `run`, used only if the backend never timed it. */
  elapsed?: number;
  /** Start expanded — carries over a detail the person already opened live. */
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [state, setState] = useState<"idle" | "loading" | "ready" | "unavailable">("idle");
  const [replayed, setReplayed] = useState<RunState | null>(null);
  // Remember the in-memory run once seen, so this keeps showing it after the
  // stage has moved on to the next run instead of falling back to a fetch.
  const [kept, setKept] = useState<{ run: RunState; elapsed?: number } | null>(
    memoryRun ? { run: memoryRun, elapsed } : null,
  );
  if (memoryRun && kept?.run !== memoryRun) setKept({ run: memoryRun, elapsed });
  const regionId = useId();

  const run = kept?.run ?? replayed;
  const ready = Boolean(kept) || state === "ready";

  const load = async () => {
    setState("loading");
    try {
      const detail = await runsApi.get(runId);
      const events = detail.result.events;
      if (!Array.isArray(events)) {
        // A direct/no-harness turn's run_id never got an ExecutionLog row —
        // 404s below — but an older log from before this field existed
        // lands here too (result_json was `{"events": <count>}`). Same
        // honest outcome either way: nothing to replay.
        setState("unavailable");
        return;
      }
      let next = runReducer(emptyRun, { type: "reset", mode: "live", step: false });
      for (const raw of events) {
        const evt = raw as { event?: unknown; data?: unknown };
        if (typeof evt.event !== "string") continue;
        next = runReducer(next, {
          type: "sse",
          event: evt.event,
          data: (evt.data as Record<string, unknown>) ?? {},
        });
      }
      setReplayed(next);
      setState("ready");
    } catch {
      setState("unavailable");
    }
  };

  const toggle = () => {
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    if (!kept && state === "idle") void load();
  };

  return (
    <div className="flex flex-col gap-2">
      <RunDetailToggle open={open} onToggle={toggle} controlsId={regionId} />
      {open && !ready && state === "loading" && (
        <p role="status" className="text-[12px] text-ink-faint">
          Loading…
        </p>
      )}
      {open && !ready && state === "unavailable" && (
        <p className="text-[12px] text-ink-faint">
          This run&apos;s step-by-step detail wasn&apos;t saved.
        </p>
      )}
      {open && ready && run && (
        <RunDetailRegion id={regionId}>
          <Transcript run={run} onResolve={() => undefined} elapsed={kept?.elapsed} />
        </RunDetailRegion>
      )}
    </div>
  );
}
