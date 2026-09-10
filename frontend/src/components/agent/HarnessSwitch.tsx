"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronDown, Power, PowerOff } from "lucide-react";

import {
  DEFAULT_BUNDLE_ID,
  useHarnessLibraryStore,
} from "@/store/harnessLibraryStore";
import { useHarnessSessionStore } from "@/store/harnessSessionStore";

type SwitchOption = {
  id: string;
  name: string;
  kind: "default" | "library";
};

export type HarnessSwitchProps = {
  /** When true, omit outer bar chrome (used inside HarnessBar). */
  embedded?: boolean;
};

/**
 * Harness on/off + replace from the HarnessLibrary rail entries.
 * Standalone: full-width chrome bar. Embedded: inline controls for HarnessBar.
 */
export function HarnessSwitch({ embedded = false }: HarnessSwitchProps) {
  const enabled = useHarnessSessionStore((s) => s.enabled);
  const activeBundle = useHarnessSessionStore((s) => s.activeBundle);
  const hydrated = useHarnessSessionStore((s) => s.hydrated);
  const setEnabled = useHarnessSessionStore((s) => s.setEnabled);
  const hydrateSession = useHarnessSessionStore((s) => s.hydrate);

  const libraryEntries = useHarnessLibraryStore((s) => s.entries);
  const libraryHydrated = useHarnessLibraryStore((s) => s.hydrated);
  const hydrateLibrary = useHarnessLibraryStore((s) => s.hydrate);
  const activate = useHarnessLibraryStore((s) => s.activate);

  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!hydrated) {
      void hydrateSession().catch((err: Error) => setError(err.message));
    }
  }, [hydrated, hydrateSession]);

  useEffect(() => {
    if (!libraryHydrated) {
      void hydrateLibrary().catch((err: Error) => setError(err.message));
    }
  }, [libraryHydrated, hydrateLibrary]);

  const options = useMemo<SwitchOption[]>(() => {
    return libraryEntries.map((e) => ({
      id: e.id,
      name: e.name,
      kind: e.isDefault || e.id === DEFAULT_BUNDLE_ID ? "default" : "library",
    }));
  }, [libraryEntries]);

  const activeLabel =
    activeBundle?.manifest?.name ||
    activeBundle?.manifest?.id ||
    (hydrated ? "No harness" : "Loading…");

  const controls = (
    <>
      {!embedded && <span className="t-label text-ink-faint">Harness</span>}

      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        title={
          enabled
            ? "Harness on — runs walk the active bundle graph"
            : "Harness off — direct single turn"
        }
        onClick={() => setEnabled(!enabled)}
        className={[
          "inline-flex h-[24px] items-center gap-1.5 rounded-control px-2.5 text-[12px] font-[500] transition",
          enabled
            ? "bg-signal text-[color:var(--signal-ink)] hover:opacity-90"
            : "border border-line bg-sub-200 text-ink-dim hover:bg-sub-300 hover:text-ink",
        ].join(" ")}
      >
        {enabled ? (
          <Power size={12} strokeWidth={2} />
        ) : (
          <PowerOff size={12} strokeWidth={1.8} />
        )}
        <span>{enabled ? "On" : "Off"}</span>
      </button>

      <span className="mx-0.5 h-[14px] w-px flex-none bg-line-soft" aria-hidden />

      <div className={`relative min-w-0 ${embedded ? "w-[180px] max-w-[220px]" : "flex-1"}`}>
        <button
          type="button"
          disabled={!enabled || options.length === 0}
          onClick={() => setOpen((v) => !v)}
          className="flex h-[24px] w-full max-w-[320px] items-center gap-1.5 rounded-control border border-line bg-sub-200 px-2.5 text-left text-[12px] text-ink-dim transition hover:bg-sub-300 hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
          title="Replace active harness"
        >
          <span className="min-w-0 flex-1 truncate font-[500] text-ink">{activeLabel}</span>
          <ChevronDown size={12} strokeWidth={1.8} className="flex-none text-ink-faint" />
        </button>

        {open && (
          <ul
            className="oh-float absolute left-0 top-[28px] z-20 max-h-[220px] w-full max-w-[320px] overflow-auto py-1"
            role="listbox"
          >
            {options.map((opt) => {
              const selected = opt.id === activeBundle?.manifest?.id;
              return (
                <li key={opt.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={selected}
                    className={[
                      "flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[12px] transition",
                      selected
                        ? "bg-sub-300 text-ink"
                        : "text-ink-dim hover:bg-sub-200 hover:text-ink",
                    ].join(" ")}
                    onClick={() => {
                      activate(opt.id);
                      setOpen(false);
                    }}
                  >
                    <span className="min-w-0 flex-1 truncate">{opt.name}</span>
                    {opt.kind === "default" && (
                      <span className="t-meta flex-none text-signal">default</span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {error && (
        <span className="t-meta max-w-[140px] truncate text-fault" title={error}>
          {error}
        </span>
      )}
    </>
  );

  if (embedded) {
    return <div className="flex min-w-0 items-center gap-2.5">{controls}</div>;
  }

  return (
    <div className="flex h-[36px] flex-none items-center gap-2.5 border-b border-line bg-sub-100/90 px-3">
      {controls}
    </div>
  );
}
