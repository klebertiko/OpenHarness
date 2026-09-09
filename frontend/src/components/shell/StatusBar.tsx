"use client";
import { useShellStore } from "./shellStore";

/**
 * Status bar — 22px, entirely mono, entirely machine-written.
 *
 * The rule this bar enforces for the whole app: if a string was written by a
 * machine (an id, a model name, a count, a latency), it is mono and dim. If a
 * person wrote it, it is the grotesque. That single split is what keeps a
 * dense desktop UI legible without adding a second accent colour.
 */

function Cell({
  k,
  v,
  tone = "dim",
}: {
  k: string;
  v: string;
  tone?: "dim" | "signal" | "warn" | "fault";
}) {
  const color =
    tone === "signal"
      ? "var(--signal)"
      : tone === "warn"
        ? "var(--warn)"
        : tone === "fault"
          ? "var(--fault)"
          : "var(--ink-dim)";
  return (
    <span className="t-meta flex items-center gap-1.5 border-r border-line-soft px-2.5 text-ink-faint">
      {k}
      <span style={{ color }}>{v}</span>
    </span>
  );
}

interface Props {
  mode: string;
  running: boolean;
  nodeCount: number;
  edgeCount: number;
  selectedId: string | null;
  backendOk: boolean;
}

export function StatusBar({ mode, running, nodeCount, edgeCount, selectedId, backendOk }: Props) {
  const { section, setKeymapOpen } = useShellStore();

  return (
    <footer className="flex h-statusbar flex-none items-stretch border-t border-line bg-sub-100">
      <span className="t-meta flex items-center gap-1.5 border-r border-line-soft px-2.5">
        <span
          className="h-[5px] w-[5px] rounded-[1px]"
          style={{ background: running ? "var(--signal)" : "var(--ink-faint)" }}
          aria-hidden
        />
        <span className="uppercase text-ink-dim">{running ? "executing" : "ready"}</span>
      </span>

      <Cell k="mode" v={mode} tone={mode.includes("live") ? "warn" : "dim"} />
      <Cell k="section" v={section} />
      <Cell k="graph" v={`${nodeCount}n · ${edgeCount}e`} />
      {selectedId && <Cell k="sel" v={selectedId} />}

      <span className="flex-1" />

      <Cell
        k="backend"
        v={backendOk ? "connected" : "offline"}
        tone={backendOk ? "dim" : "fault"}
      />
      <button
        type="button"
        onClick={() => setKeymapOpen(true)}
        className="t-meta flex items-center gap-1.5 px-2.5 text-ink-faint transition-colors hover:bg-sub-300 hover:text-ink-dim"
      >
        <kbd className="oh-kbd">?</kbd>
        keys
      </button>
    </footer>
  );
}
