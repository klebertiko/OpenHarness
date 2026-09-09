"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronDown, Power, PowerOff } from "lucide-react";

import { fetchDefault, type OHarnessBundle } from "@/lib/bundlesApi";
import {
  useHarnessSessionStore,
  type HarnessBundle,
} from "@/store/harnessSessionStore";

type SwitchOption = {
  id: string;
  name: string;
  bundle: HarnessBundle;
  kind: "default" | "active";
};

/**
 * Harness on/off + replace from the session's known bundles.
 *
 * Task 4 scope: default (from `/bundles/default`) and the current active
 * bundle. Full library rail is Task 5.
 */
export function HarnessSwitch() {
  const enabled = useHarnessSessionStore((s) => s.enabled);
  const activeBundle = useHarnessSessionStore((s) => s.activeBundle);
  const hydrated = useHarnessSessionStore((s) => s.hydrated);
  const setEnabled = useHarnessSessionStore((s) => s.setEnabled);
  const replaceBundle = useHarnessSessionStore((s) => s.replaceBundle);
  const hydrate = useHarnessSessionStore((s) => s.hydrate);

  const [defaultBundle, setDefaultBundle] = useState<OHarnessBundle | null>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!hydrated) {
      void hydrate().catch((err: Error) => setError(err.message));
    }
  }, [hydrated, hydrate]);

  useEffect(() => {
    let alive = true;
    fetchDefault()
      .then((b) => {
        if (alive) setDefaultBundle(b);
      })
      .catch((err: Error) => {
        if (alive) setError(err.message);
      });
    return () => {
      alive = false;
    };
  }, []);

  const options = useMemo<SwitchOption[]>(() => {
    const out: SwitchOption[] = [];
    if (defaultBundle?.manifest?.id) {
      out.push({
        id: defaultBundle.manifest.id,
        name: defaultBundle.manifest.name || "Default",
        bundle: defaultBundle as unknown as HarnessBundle,
        kind: "default",
      });
    }
    if (
      activeBundle?.manifest?.id &&
      activeBundle.manifest.id !== defaultBundle?.manifest?.id
    ) {
      out.push({
        id: activeBundle.manifest.id,
        name: activeBundle.manifest.name || activeBundle.manifest.id,
        bundle: activeBundle,
        kind: "active",
      });
    }
    return out;
  }, [defaultBundle, activeBundle]);

  const activeLabel =
    activeBundle?.manifest?.name ||
    activeBundle?.manifest?.id ||
    (hydrated ? "No harness" : "Loading…");

  return (
    <div className="flex h-[34px] flex-none items-center gap-2 border-b border-line bg-sub-100 px-2.5">
      <span className="t-label text-ink-faint">HARNESS</span>

      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        title={enabled ? "Harness on — runs walk the active bundle graph" : "Harness off — direct single turn"}
        onClick={() => setEnabled(!enabled)}
        className="inline-flex h-[22px] items-center gap-1.5 rounded-control border border-line bg-sub-200 px-2 text-[12px] font-[550] text-ink-dim transition hover:bg-sub-300 hover:text-ink"
      >
        {enabled ? (
          <Power size={12} strokeWidth={1.8} className="text-signal" />
        ) : (
          <PowerOff size={12} strokeWidth={1.8} className="text-ink-mute" />
        )}
        <span>{enabled ? "On" : "Off"}</span>
      </button>

      <span className="mx-0.5 h-[14px] w-px flex-none bg-line-soft" aria-hidden />

      <div className="relative min-w-0 flex-1">
        <button
          type="button"
          disabled={!enabled || options.length === 0}
          onClick={() => setOpen((v) => !v)}
          className="flex h-[22px] w-full max-w-[280px] items-center gap-1.5 rounded-control border border-line bg-sub-200 px-2 text-left text-[12px] text-ink-dim transition hover:bg-sub-300 hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
          title="Replace active harness"
        >
          <span className="min-w-0 flex-1 truncate">{activeLabel}</span>
          <ChevronDown size={12} strokeWidth={1.8} className="flex-none text-ink-faint" />
        </button>

        {open && (
          <ul
            className="absolute left-0 top-[26px] z-20 max-h-[200px] w-full max-w-[280px] overflow-auto rounded-control border border-line bg-sub-100 py-0.5 shadow-sm"
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
                    className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-[12px] text-ink-dim hover:bg-sub-200 hover:text-ink"
                    onClick={() => {
                      replaceBundle(opt.bundle);
                      setOpen(false);
                    }}
                  >
                    <span className="min-w-0 flex-1 truncate">{opt.name}</span>
                    {opt.kind === "default" && (
                      <span className="t-meta flex-none text-ink-faint">default</span>
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
    </div>
  );
}
