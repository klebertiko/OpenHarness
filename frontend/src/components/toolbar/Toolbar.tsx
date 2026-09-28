"use client";
import { Play, Save, Upload, Download, Undo2, Redo2, Square } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useCanvasStore } from "@/store/canvasStore";
import { chordCaps, useIsMac } from "@/components/shell/keys";
import type { ExecutionMode } from "@/lib/types";

/**
 * The bench bar — the second tier of chrome, 32px, immediately under the window
 * title bar. It holds transport and file verbs only. Everything it can do is
 * also in the command palette; this row exists for the hand, not the keyboard.
 *
 * Re-themed from the POC toolbar by the shell workstream: emoji labels became
 * role iconography, the mode `<select>` became a segmented control (a native
 * dropdown for three fixed values costs a click and a popup for nothing), and
 * the logic moved to lib/actions.ts so the palette shares it.
 */

const MODES: { id: ExecutionMode; label: string; hint: string }[] = [
  { id: "mock", label: "Mock", hint: "Deterministic replay — no provider is called" },
  { id: "live", label: "Connected", hint: "Run with each node’s pinned provider, local or cloud" },
];

function IconButton({
  icon: Icon,
  label,
  chord,
  onClick,
  disabled,
}: {
  icon: LucideIcon;
  label: string;
  chord?: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  const mac = useIsMac();
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={chord ? `${label} · ${chordCaps(chord, mac).join(" ")}` : label}
      aria-label={label}
      className="grid h-[22px] w-[24px] place-items-center rounded-control text-ink-mute transition-colors hover:bg-sub-300 hover:text-ink disabled:pointer-events-none disabled:opacity-30"
    >
      <Icon size={14} strokeWidth={1.6} absoluteStrokeWidth />
    </button>
  );
}

interface Props {
  onRun: () => void;
  onStop: () => void;
  onSave: () => void;
  onExport: () => void;
  onImport: () => void;
  saveMsg: string;
}

export function Toolbar({ onRun, onStop, onSave, onExport, onImport, saveMsg }: Props) {
  const mac = useIsMac();
  const { nodes, executionMode, isRunning, setExecutionMode, undo, redo } =
    useCanvasStore();

  const runCaps = chordCaps("Mod+Enter", mac);

  return (
    <div className="flex h-[32px] flex-none items-center gap-1.5 border-b border-line bg-sub-100 px-2">
      {isRunning ? (
        <button
          type="button"
          onClick={onStop}
          className="flex h-[22px] items-center gap-1.5 rounded-control border border-line bg-sub-200 px-2 text-ink transition-colors hover:bg-sub-300"
        >
          <Square size={9} strokeWidth={0} fill="currentColor" />
          <span className="t-title">Stop</span>
        </button>
      ) : (
        <button
          type="button"
          onClick={onRun}
          disabled={nodes.length === 0}
          className="flex h-[22px] items-center gap-1.5 rounded-control bg-signal pl-2 pr-1.5 text-[color:var(--signal-ink)] transition-colors hover:bg-[color-mix(in_oklab,var(--signal)_88%,white)] disabled:pointer-events-none disabled:bg-sub-300 disabled:text-ink-faint"
        >
          <Play size={11} strokeWidth={0} fill="currentColor" />
          <span className="t-title">Run</span>
          <span className="flex items-center gap-[2px] opacity-55">
            {runCaps.map((c) => (
              <span
                key={c}
                className="t-meta rounded-[1px] bg-[rgb(0_0_0/0.16)] px-1 leading-[14px]"
              >
                {c}
              </span>
            ))}
          </span>
        </button>
      )}

      <span className="mx-1 h-[16px] w-px bg-line" aria-hidden />

      {/* Mode — a segmented control. Simulation and connected execution use separate controls. */}
      <div
        role="radiogroup"
        aria-label="Execution mode"
        className="flex h-[22px] items-stretch overflow-hidden rounded-control border border-line-soft bg-sub-200"
      >
        {MODES.map((m) => {
          const active = m.id === "live" ? executionMode !== "mock" : executionMode === "mock";
          return (
            <button
              key={m.id}
              type="button"
              role="radio"
              aria-checked={active}
              tabIndex={active ? 0 : -1}
              title={m.hint}
              disabled={isRunning}
              onClick={() => setExecutionMode(m.id)}
              onKeyDown={(event) => {
                if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
                event.preventDefault();
                const radios = Array.from(event.currentTarget.parentElement!.querySelectorAll<HTMLButtonElement>('[role="radio"]'));
                const index = radios.indexOf(event.currentTarget);
                const next = event.key === "Home" ? 0 : event.key === "End" ? radios.length - 1
                  : (index + (event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 1) + radios.length) % radios.length;
                radios[next].focus();
                radios[next].click();
              }}
              className={[
                "t-meta border-r border-line-soft px-2 uppercase transition-colors last:border-r-0 disabled:opacity-40",
                active ? "bg-sub-400 text-ink" : "text-ink-mute hover:text-ink-dim",
              ].join(" ")}
            >
              {m.label}
            </button>
          );
        })}
      </div>

      <span className="mx-1 h-[16px] w-px bg-line" aria-hidden />

      <IconButton icon={Undo2} label="Undo" chord="Mod+Z" onClick={undo} disabled={isRunning} />
      <IconButton icon={Redo2} label="Redo" chord="Mod+Shift+Z" onClick={redo} disabled={isRunning} />

      <span className="flex-1" />

      {saveMsg && <span className="t-meta mr-1 text-ink-mute">{saveMsg}</span>}

      <IconButton icon={Save} label="Save harness" chord="Mod+S" onClick={onSave} />
      <IconButton
        icon={Download}
        label="Export graph JSON (advanced)"
        chord="Mod+Shift+E"
        onClick={onExport}
      />
      <IconButton icon={Upload} label="Import graph JSON (advanced)" onClick={onImport} disabled={isRunning} />
    </div>
  );
}
