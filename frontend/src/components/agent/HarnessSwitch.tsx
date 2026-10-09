"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronDown, Workflow } from "lucide-react";

import { harnessSubtitle, splitHarnessName } from "@/components/harnesses/harnessLabel";
import { ComboAction, Combobox, type ComboOption } from "@/components/ui/Combobox";
import { useHarnessLibraryStore } from "@/store/harnessLibraryStore";
import { useHarnessSessionStore } from "@/store/harnessSessionStore";

export type HarnessSwitchProps = {
  /** Kept for existing callers; the picker is always inline now. */
  embedded?: boolean;
  onOpenStudio?: () => void;
};

/** Option id for "No harness" — no harness id can be empty. */
const NONE_ID = "";

/**
 * One control for "which harness runs this conversation", in the composer
 * toolbar. "No harness" is the first option rather than a separate on/off
 * switch, so choosing and enabling are one gesture. Built on the shared
 * Combobox (portalled, viewport-clamped, keyboard-first).
 */
export function HarnessSwitch({ onOpenStudio }: HarnessSwitchProps) {
  const enabled = useHarnessSessionStore((s) => s.enabled);
  const activeBundle = useHarnessSessionStore((s) => s.activeBundle);
  const hydrated = useHarnessSessionStore((s) => s.hydrated);
  const setEnabled = useHarnessSessionStore((s) => s.setEnabled);
  const hydrateSession = useHarnessSessionStore((s) => s.hydrate);

  const entries = useHarnessLibraryStore((s) => s.entries);
  const libraryHydrated = useHarnessLibraryStore((s) => s.hydrated);
  const hydrateLibrary = useHarnessLibraryStore((s) => s.hydrate);
  const activate = useHarnessLibraryStore((s) => s.activate);

  const [error, setError] = useState("");

  useEffect(() => {
    if (!hydrated) void hydrateSession().catch((err: Error) => setError(err.message));
  }, [hydrated, hydrateSession]);

  useEffect(() => {
    if (!libraryHydrated) void hydrateLibrary().catch((err: Error) => setError(err.message));
  }, [libraryHydrated, hydrateLibrary]);

  const options = useMemo<ComboOption[]>(
    () => [
      { id: NONE_ID, label: "No harness", detail: "Direct conversation with the model" },
      ...entries.map((e) => ({ id: e.id, label: splitHarnessName(e.name).title, detail: harnessSubtitle(e) })),
    ],
    [entries],
  );

  const activeId = enabled ? (activeBundle?.manifest?.id ?? NONE_ID) : NONE_ID;
  const activeName = activeBundle?.manifest?.name || activeBundle?.manifest?.id;
  const label = !enabled ? "No harness" : activeName ? splitHarnessName(activeName).title : hydrated ? "No harness" : "Loading…";

  const choose = (id: string) => {
    if (id === NONE_ID) {
      setEnabled(false);
    } else {
      activate(id);
      if (!enabled) setEnabled(true);
    }
  };

  return (
    <>
      <Combobox
        label="Harness"
        triggerLabel={`Harness: ${label}`}
        value={activeId}
        options={options}
        onChange={choose}
        status={libraryHydrated ? "ready" : error ? "error" : "loading"}
        loadingText="Loading harnesses…"
        errorText="Couldn't load harnesses."
        triggerClassName="h-8 max-w-[260px] px-2.5 text-[12px] font-[550] text-ink-dim hover:text-ink"
        trigger={
          <>
            <Workflow size={14} strokeWidth={1.8} className={enabled ? "flex-none text-signal" : "flex-none text-ink-faint"} aria-hidden />
            <span className="min-w-0 truncate">{label}</span>
            <ChevronDown size={13} strokeWidth={1.8} className="flex-none text-ink-faint" aria-hidden />
          </>
        }
        footer={
          onOpenStudio
            ? ({ close }) => (
                <>
                  {onOpenStudio && (
                    <ComboAction
                      onClick={() => {
                        close(false);
                        onOpenStudio();
                      }}
                    >
                      Edit in Studio
                    </ComboAction>
                  )}
                </>
              )
            : undefined
        }
      />
      {error && (
        <span className="max-w-[140px] truncate text-[11px] text-fault" title={error}>
          Couldn&apos;t load harnesses
        </span>
      )}
    </>
  );
}
