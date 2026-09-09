"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Upload } from "lucide-react";

import { Panel } from "@/components/shell/Panel";
import { isOHarnessBundle, validateBundle } from "@/lib/bundlesApi";
import {
  DEFAULT_BUNDLE_ID,
  useHarnessLibraryStore,
  type LibraryEntry,
} from "@/store/harnessLibraryStore";
import { useHarnessSessionStore, type HarnessBundle } from "@/store/harnessSessionStore";

/**
 * Harnesses rail — always lists the skills-framework default, plus imports.
 * Activate swaps the session bundle and turns the harness on.
 */
export function HarnessLibrary() {
  const fileRef = useRef<HTMLInputElement>(null);
  const entries = useHarnessLibraryStore((s) => s.entries);
  const hydrated = useHarnessLibraryStore((s) => s.hydrated);
  const hydrate = useHarnessLibraryStore((s) => s.hydrate);
  const importBundle = useHarnessLibraryStore((s) => s.importBundle);
  const activate = useHarnessLibraryStore((s) => s.activate);
  const remove = useHarnessLibraryStore((s) => s.remove);

  const activeId = useHarnessSessionStore((s) => s.activeBundle?.manifest.id ?? null);

  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!hydrated) {
      void hydrate().catch((err: Error) => setError(err.message));
    }
  }, [hydrated, hydrate]);

  const onImportFile = async (file: File) => {
    setBusy(true);
    setError("");
    try {
      const text = await file.text();
      const parsed: unknown = JSON.parse(text);
      const result = await validateBundle(parsed);
      if (!result.ok) {
        setError(result.errors?.[0] || "Import failed validation");
        return;
      }
      if (!isOHarnessBundle(parsed)) {
        setError("Not a recognizable .oharness bundle");
        return;
      }
      importBundle(parsed as unknown as HarnessBundle);
    } catch (err) {
      setError((err as Error).message || "Import failed");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <Panel
      title="Harnesses"
      meta={hydrated ? `${entries.length}` : "…"}
      className="h-full"
      actions={
        <>
          <input
            ref={fileRef}
            type="file"
            accept=".oharness,application/json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onImportFile(f);
            }}
          />
          <button
            type="button"
            disabled={busy}
            title="Import .oharness into library"
            onClick={() => fileRef.current?.click()}
            className="inline-flex h-[22px] items-center gap-1 rounded-control border border-line bg-sub-200 px-1.5 text-[11px] font-[550] text-ink-dim transition hover:bg-sub-300 hover:text-ink disabled:opacity-40"
          >
            <Upload size={11} strokeWidth={1.8} />
            Import
          </button>
        </>
      }
    >
      {!hydrated && !error && (
        <p className="t-body p-3 text-ink-mute">Loading default harness…</p>
      )}

      {error && (
        <p className="t-body border-b border-line-soft px-3 py-2 text-fault" role="alert">
          {error}
        </p>
      )}

      <ul className="flex flex-col">
        {entries.map((entry) => (
          <LibraryRow
            key={entry.id}
            entry={entry}
            active={entry.id === activeId}
            onActivate={() => activate(entry.id)}
            onRemove={
              entry.isDefault || entry.id === DEFAULT_BUNDLE_ID
                ? undefined
                : () => remove(entry.id)
            }
          />
        ))}
      </ul>
    </Panel>
  );
}

function LibraryRow({
  entry,
  active,
  onActivate,
  onRemove,
}: {
  entry: LibraryEntry;
  active: boolean;
  onActivate: () => void;
  onRemove?: () => void;
}) {
  const showDefault =
    entry.isDefault || entry.id === DEFAULT_BUNDLE_ID;

  return (
    <li className="flex flex-col gap-1.5 border-b border-line-soft px-2.5 py-2 last:border-b-0">
      <div className="flex min-w-0 items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="t-title truncate text-ink">{entry.name}</span>
            {showDefault && (
              <span className="t-meta rounded-[2px] border border-line bg-sub-200 px-1 py-px text-ink-faint">
                default
              </span>
            )}
            {active && (
              <span className="t-meta inline-flex items-center gap-0.5 text-signal">
                <Check size={10} strokeWidth={2} />
                active
              </span>
            )}
          </div>
          <div className="t-meta truncate text-ink-faint">{entry.id}</div>
          {entry.description && (
            <p className="t-body mt-0.5 line-clamp-2 text-ink-mute">{entry.description}</p>
          )}
        </div>
      </div>
      <div className="flex items-center gap-1">
        <button
          type="button"
          disabled={active}
          onClick={onActivate}
          className="inline-flex h-[22px] items-center rounded-control border border-line bg-sub-200 px-2 text-[11px] font-[550] text-ink-dim transition hover:bg-sub-300 hover:text-ink disabled:cursor-default disabled:opacity-40"
        >
          {active ? "Active" : "Activate"}
        </button>
        {onRemove && (
          <button
            type="button"
            onClick={onRemove}
            className="inline-flex h-[22px] items-center rounded-control px-2 text-[11px] text-ink-faint transition hover:text-fault"
          >
            Remove
          </button>
        )}
      </div>
    </li>
  );
}
