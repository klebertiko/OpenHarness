"use client";

import { useState } from "react";
import { runsApi } from "@/lib/runsApi";
import { Transcript } from "./Transcript";
import { emptyRun, runReducer } from "./runReducer";
import type { RunState } from "./types";

/**
 * "Show run detail" for a message from a *previous* session — the live
 * `RunState` in `useRunStream` is in-memory only and is gone the moment the
 * page reloads, even though the chat bubble's own summary text survives
 * (it's saved onto the thread message). This rebuilds an equivalent
 * `RunState` by replaying the real event log the sidecar persisted
 * (`GET /execute/logs/{runId}`, `ExecutionLog.result_json`) through the same
 * reducer the live view uses, so the two render identically.
 */
export function HistoricalRunDetail({ runId }: { runId: string }) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<"idle" | "loading" | "ready" | "unavailable">("idle");
  const [run, setRun] = useState<RunState | null>(null);

  const toggle = async () => {
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    if (state !== "idle") return;
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
      setRun(next);
      setState("ready");
    } catch {
      setState("unavailable");
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={() => void toggle()}
        className="self-start text-[12px] text-ink-faint underline-offset-2 hover:text-ink-mute hover:underline"
      >
        {open ? "Hide run detail" : "Show run detail"}
      </button>
      {open && state === "loading" && (
        <p className="text-[12px] text-ink-faint">Loading…</p>
      )}
      {open && state === "unavailable" && (
        <p className="text-[12px] text-ink-faint">
          This run&apos;s step-by-step detail wasn&apos;t saved.
        </p>
      )}
      {open && state === "ready" && run && (
        <div className="overflow-hidden rounded-panel border border-line bg-sub-100">
          <Transcript run={run} onResolve={() => undefined} />
        </div>
      )}
    </div>
  );
}
