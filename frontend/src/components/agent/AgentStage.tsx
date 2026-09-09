"use client";

import { useEffect, useMemo, useState } from "react";

import { AutomationsPanel } from "@/components/automations/AutomationsPanel";
import { HarnessSwitch } from "@/components/agent/HarnessSwitch";
import { CoworkPanel } from "@/components/cowork/CoworkPanel";
import { RunControls } from "@/components/agent-run/RunControls";
import { RunLadder } from "@/components/agent-run/RunLadder";
import { Transcript } from "@/components/agent-run/Transcript";
import { useRunStream } from "@/components/agent-run/useRunStream";
import { bundleGraphToEngine } from "@/lib/bundleGraph";
import type { ExecutionMode } from "@/lib/types";
import { useCanvasStore } from "@/store/canvasStore";
import { useHarnessSessionStore } from "@/store/harnessSessionStore";

const MODES: ExecutionMode[] = ["mock", "live", "local"];

type AgentTab = "chat" | "cowork" | "automations";

/**
 * Agent mode stage — harness switch + Chat / Cowork / Automations sub-nav.
 *
 * Harness on → `/api/run` with the active bundle graph (instruction seeded on
 * the first node). Harness off → `/api/run/direct`. Stop uses
 * `/api/run/[id]/control`.
 */
export function AgentStage() {
  const enabled = useHarnessSessionStore((s) => s.enabled);
  const activeBundle = useHarnessSessionStore((s) => s.activeBundle);
  const hydrated = useHarnessSessionStore((s) => s.hydrated);
  const hydrate = useHarnessSessionStore((s) => s.hydrate);

  const executionMode = useCanvasStore((s) => s.executionMode);
  const setExecutionMode = useCanvasStore((s) => s.setExecutionMode);
  const setRunning = useCanvasStore((s) => s.setRunning);

  const [tab, setTab] = useState<AgentTab>("chat");
  const [instruction, setInstruction] = useState("");
  const [step, setStep] = useState(false);

  useEffect(() => {
    if (!hydrated) void hydrate().catch(() => undefined);
  }, [hydrated, hydrate]);

  const graph = useMemo(
    () =>
      bundleGraphToEngine(
        activeBundle?.graph as { nodes?: unknown[]; edges?: unknown[] } | undefined,
        instruction.trim() || undefined
      ),
    [activeBundle, instruction]
  );

  const { run, elapsed, live, start, stop, advance, resolveGate } = useRunStream({
    graph,
    harnessEnabled: enabled,
  });

  useEffect(() => {
    setRunning(live);
  }, [live, setRunning]);

  const canStart =
    !live &&
    instruction.trim().length > 0 &&
    (!enabled || graph.nodes.length > 0);

  const onStart = () => {
    if (!canStart) return;
    start({ instruction: instruction.trim(), mode: executionMode, step });
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <HarnessSwitch />

      <div
        role="tablist"
        aria-label="Agent surfaces"
        className="flex h-[28px] flex-none items-center gap-px border-b border-line bg-sub-100 px-2"
      >
        {(
          [
            ["chat", "Chat"],
            ["cowork", "Cowork"],
            ["automations", "Automations"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={`h-[22px] rounded-control px-2.5 text-[11px] font-[550] transition ${
              tab === id
                ? "bg-sub-300 text-ink"
                : "text-ink-mute hover:bg-sub-200 hover:text-ink"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "cowork" && (
        <div className="min-h-0 flex-1 overflow-hidden">
          <CoworkPanel />
        </div>
      )}

      {tab === "automations" && (
        <div className="min-h-0 flex-1 overflow-hidden">
          <AutomationsPanel />
        </div>
      )}

      {tab === "chat" && (
        <>
          <div className="flex h-[28px] flex-none items-center gap-2 border-b border-line bg-sub-100 px-2.5">
            <span className="t-label text-ink-faint">MODE</span>
            <div className="flex items-center gap-px overflow-hidden rounded-control border border-line">
              {MODES.map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setExecutionMode(m)}
                  className={`h-[20px] px-2 text-[11px] font-[550] capitalize transition ${
                    executionMode === m
                      ? "bg-sub-300 text-ink"
                      : "bg-sub-200 text-ink-mute hover:text-ink"
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>
            <label className="ml-1 flex items-center gap-1.5 text-[11px] text-ink-mute">
              <input
                type="checkbox"
                checked={step}
                onChange={(e) => setStep(e.target.checked)}
                disabled={!enabled}
                className="accent-[var(--signal)]"
              />
              Step
            </label>
            <span className="flex-1" />
            <span className="t-meta text-ink-faint">
              {enabled ? "graph run" : "direct turn"}
            </span>
          </div>

          <RunControls
            run={run}
            elapsed={elapsed}
            live={live}
            onStart={onStart}
            onStop={stop}
            onStep={advance}
          />
          <RunLadder run={run} />
          <Transcript run={run} onResolve={resolveGate} />

          <div className="flex flex-none gap-2 border-t border-line bg-sub-100 p-2.5">
            <textarea
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                  e.preventDefault();
                  onStart();
                }
              }}
              rows={2}
              placeholder={
                enabled
                  ? "Instruction for this harness run…"
                  : "Message for a direct model turn…"
              }
              className="min-h-[52px] min-w-0 flex-1 resize-none rounded-control border border-line bg-sub-200 px-2.5 py-2 text-[13px] text-ink outline-none placeholder:text-ink-faint focus:border-ink-mute"
            />
            <button
              type="button"
              disabled={!canStart}
              onClick={onStart}
              className="h-[52px] flex-none rounded-control bg-signal px-3 text-[12px] font-[550] text-signal-ink transition hover:bg-signal-deep disabled:cursor-not-allowed disabled:opacity-40"
            >
              {run.runId ? "Run again" : "Run"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
