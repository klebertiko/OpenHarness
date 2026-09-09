"use client";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import type { HarnessGraph } from "@/lib/types";
import { emptyRun, runReducer } from "./runReducer";
import { sendControl, startRun } from "./runClient";
import type { RunState } from "./types";

export interface RunController {
  run: RunState;
  /** Milliseconds since the run opened — ticks while live, freezes when it ends. */
  elapsed: number;
  live: boolean;
  start: (opts: { instruction: string; mode: string; step: boolean }) => void;
  stop: () => void;
  advance: () => void;
  resolveGate: (decision: "approve" | "reject", note: string) => void;
  steer: (text: string) => void;
}

const LIVE = new Set(["starting", "running", "gate", "paused"]);

export function useRunStream(graph: HarnessGraph): RunController {
  const [run, dispatch] = useReducer(runReducer, emptyRun);
  const abortRef = useRef<(() => void) | null>(null);
  const graphRef = useRef(graph);
  graphRef.current = graph;

  const live = LIVE.has(run.status);

  /* One shared clock for the header, the now-line and the gate. A run that has
     been parked at a human gate for four minutes should say so; freezing the
     timer the moment the tokens stop would hide exactly that. */
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!run.startedAt) return;
    if (!live) {
      setElapsed(run.endedAt ? run.endedAt - run.startedAt : elapsed);
      return;
    }
    const id = window.setInterval(() => setElapsed(Date.now() - run.startedAt!), 100);
    setElapsed(Date.now() - run.startedAt);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run.startedAt, run.endedAt, live]);

  const start = useCallback(
    ({ instruction, mode, step }: { instruction: string; mode: string; step: boolean }) => {
      abortRef.current?.();
      dispatch({ type: "reset", mode, step });
      abortRef.current = startRun(
        { graph_json: graphRef.current, mode, step, instruction },
        (event, data) => dispatch({ type: "sse", event, data }),
        (err) => {
          if (err) dispatch({ type: "transport-error", message: err.message });
        }
      );
    },
    []
  );

  const stop = useCallback(() => {
    if (run.runId) void sendControl(run.runId, { action: "stop" });
    // Do not abort the fetch here: the engine unwinds at its next checkpoint
    // and emits `run_stopped` + `harness_done`, which is what tells the panel
    // where it actually got to.
  }, [run.runId]);

  const advance = useCallback(() => {
    if (run.runId) void sendControl(run.runId, { action: "step" });
  }, [run.runId]);

  const resolveGate = useCallback(
    (decision: "approve" | "reject", note: string) => {
      if (run.runId) void sendControl(run.runId, { action: "resume", decision, note });
    },
    [run.runId]
  );

  const steer = useCallback(
    (text: string) => {
      if (run.runId) void sendControl(run.runId, { action: "message", text });
    },
    [run.runId]
  );

  useEffect(() => () => abortRef.current?.(), []);

  return { run, elapsed, live, start, stop, advance, resolveGate, steer };
}
