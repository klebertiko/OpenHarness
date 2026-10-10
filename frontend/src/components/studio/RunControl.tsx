"use client";
import { ChevronDown, FlaskConical, MessageSquare, Play, Square } from "lucide-react";
import { Menu, MenuHeading, MenuItem, MenuSeparator } from "@/components/ui/Menu";
import { chordCaps, useIsMac } from "@/components/shell/keys";
import { useHarnessActions } from "@/lib/actions";
import { useStudioInChat } from "@/lib/studio";
import { useCanvasStore } from "@/store/canvasStore";
import { useReadinessStore } from "./readinessStore";

/**
 * Run, and the one place that decides how it runs. A split button: the main
 * half runs; the other half names the mode and holds the choices (Mock or
 * Connected), Plan simulation and Run in chat. While a run is going the same
 * spot becomes Stop.
 */

const MODES = [
  { id: "mock", label: "Mock", hint: "Deterministic replay. No provider is called." },
  { id: "live", label: "Connected", hint: "Uses each node's pinned provider, local or cloud." },
] as const;

export function RunControl() {
  const mac = useIsMac();
  const actions = useHarnessActions();
  const nodes = useCanvasStore((s) => s.nodes);
  const isRunning = useCanvasStore((s) => s.isRunning);
  const executionMode = useCanvasStore((s) => s.executionMode);
  const setExecutionMode = useCanvasStore((s) => s.setExecutionMode);
  const runPlan = useReadinessStore((s) => s.runPlan);

  // `local` is a legacy alias of Connected; only two behaviours exist.
  const connected = executionMode !== "mock";
  const modeLabel = connected ? "Connected" : "Mock";
  const empty = nodes.length === 0;
  const caps = chordCaps("Mod+Enter", mac);
  const half = "inline-flex h-8 items-center gap-1.5 text-[12px] font-medium transition-colors disabled:cursor-not-allowed";

  return (
    <div className="flex flex-none items-stretch">
      {isRunning ? (
        <button type="button" onClick={actions.stop} className={`${half} rounded-l-control border border-line bg-sub-200 px-2.5 text-ink hover:bg-sub-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-signal`}>
          <Square size={11} strokeWidth={0} fill="currentColor" aria-hidden /> Stop
        </button>
      ) : (
        <button
          type="button"
          aria-label="Run"
          title={`Run harness · ${caps.join(" ")}`}
          disabled={empty}
          onClick={actions.run}
          className={`${half} rounded-l-control bg-signal px-2.5 text-signal-ink hover:bg-signal-deep disabled:bg-sub-300 disabled:text-ink-faint focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal`}
        >
          <Play size={12} strokeWidth={0} fill="currentColor" aria-hidden /> Run
        </button>
      )}
      <Menu
        label={`Run options (${modeLabel})`}
        align="end"
        disabled={isRunning}
        triggerTitle={`Mode: ${modeLabel}. Plan, or run in chat.`}
        triggerClassName={`${half} h-8 rounded-r-control border border-l-0 border-line bg-sub-100 px-2 text-ink-dim hover:bg-sub-200 hover:text-ink disabled:opacity-40`}
        trigger={<><span>{modeLabel}</span><ChevronDown size={12} aria-hidden /></>}
      >
        <MenuHeading>Run mode</MenuHeading>
        {MODES.map((m) => (
          <MenuItem key={m.id} checked={m.id === "mock" ? !connected : connected} hint={m.id === "mock" ? "default" : undefined} onSelect={() => setExecutionMode(m.id)}>
            <span className="block">{m.label}</span>
            <span className="block text-[11px] font-normal text-ink-faint">{m.hint}</span>
          </MenuItem>
        ))}
        <MenuSeparator />
        <MenuItem icon={<FlaskConical size={14} />} disabled={empty} onSelect={() => void runPlan()} hint="no provider">
          Plan simulation
        </MenuItem>
        <MenuItem icon={<MessageSquare size={14} />} disabled={empty} onSelect={useStudioInChat}>
          Run in chat
        </MenuItem>
      </Menu>
    </div>
  );
}
