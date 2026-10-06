"use client";
import { useEffect, useRef, useState } from "react";
import { ArrowRight, FolderOpen, Plus, Trash2, Workflow } from "lucide-react";
import { useCanvasStore } from "@/store/canvasStore";
import { useShellStore } from "@/components/shell/shellStore";
import { newStudioHarness, openBundledHarness, openStudioPreset } from "@/lib/studio";
import { HARNESS_PRESETS } from "@/lib/templates";
import { flushAutosave, hasStudioDraft, openSavedHarness, removeSavedHarness, useStudioDocsStore } from "@/lib/studioDocuments";
import { formatRelativeTime } from "@/lib/time";

const secondary = "inline-flex h-9 flex-none items-center justify-center gap-2 whitespace-nowrap rounded-control border border-line bg-sub-100 px-3 text-[12px] font-medium text-ink transition-colors hover:bg-sub-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-signal disabled:opacity-50";

// The engine stores naive UTC timestamps; read them as UTC, not local time.
function edited(iso: string | null | undefined): string {
  const utc = iso && !/(z|[+-]\d\d:?\d\d)$/i.test(iso) ? iso + "Z" : iso;
  const rel = formatRelativeTime(utc);
  return rel === "just now" || rel === "—" ? `Edited ${rel}` : `Edited ${rel} ago`;
}

export function StudioOverview() {
  const { harnessMeta, nodes, edges, isRunning } = useCanvasStore();
  const { setStudioView, setLibraryOpen } = useShellStore();
  const { items, loaded, error: listError, saveState, dirty, refresh } = useStudioDocsStore();
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [rowError, setRowError] = useState("");
  const unsavedDraft = !harnessMeta.id && hasStudioDraft({ nodes, edges, harnessMeta });
  useEffect(() => { void refresh(); }, [refresh]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);

  const openSaved = async (id: string) => {
    setRowError("");
    try { await openSavedHarness(id); } catch (e) { setRowError((e as Error).message || "Could not open this harness."); }
  };
  const remove = async (id: string) => {
    setRowError("");
    try { await removeSavedHarness(id); setConfirmId(null); } catch (e) { setRowError((e as Error).message); }
  };
  // Return focus to the row's delete button so keyboard users don't lose their place.
  const cancelDelete = (id: string) => {
    setConfirmId(null);
    requestAnimationFrame(() => document.querySelector<HTMLButtonElement>(`[data-delete-for="${CSS.escape(id)}"]`)?.focus());
  };
  const startFresh = async (start: () => void | Promise<void>) => {
    await flushAutosave();
    await start();
  };

  const openFramework = async () => {
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    setError("");
    try {
      await openBundledHarness(controller.signal);
    } catch {
      if (!controller.signal.aborted) setError("Could not load the bundled harness. Check that the local engine is available, then try again.");
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  };

  return (
    <section aria-labelledby="studio-heading" className="h-full min-w-0 overflow-y-auto p-4 sm:p-8">
      <div className="w-full max-w-[960px]">
        <header className="flex flex-wrap items-start justify-between gap-5 border-b border-line pb-6">
          <div className="min-w-0">
            <h1 id="studio-heading" className="text-[24px] font-semibold tracking-tight text-ink [overflow-wrap:anywhere]">Harness Studio</h1>
            <p className="mt-2 text-[13px] leading-6 text-ink-mute">Design a workflow. Connect its agents. Share it as OHM.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => void startFresh(newStudioHarness)} disabled={loading || isRunning} className="inline-flex h-9 items-center justify-center gap-2 whitespace-nowrap rounded-control bg-signal px-3 text-[12px] font-medium text-signal-ink transition-colors hover:bg-signal-deep focus-visible:outline focus-visible:outline-2 focus-visible:outline-signal disabled:opacity-50">
              <Plus size={14} aria-hidden /> New harness
            </button>
            <button type="button" onClick={() => setLibraryOpen(true)} disabled={loading || isRunning} className={secondary}>
              <FolderOpen size={14} aria-hidden /> Open .ohm
            </button>
          </div>
        </header>

        {isRunning && <p role="status" className="mt-4 text-[13px] leading-6 text-ink-mute">A run is in progress. Continue editing to inspect or stop it before opening another harness.</p>}

        <section aria-labelledby="your-harnesses" className="border-b border-line py-6">
          <h2 id="your-harnesses" className="text-[14px] font-semibold text-ink">Your harnesses</h2>
          <p className="mt-1 text-[12px] leading-5 text-ink-mute">Saved on this device as you edit. Export an OHM file to share a copy.</p>
          {listError && (
            <p role="alert" className="mt-3 text-[13px] leading-6 text-fault">
              {listError} <button type="button" className="underline" onClick={() => void refresh()}>Retry</button>
            </p>
          )}
          {rowError && <p role="alert" className="mt-3 text-[13px] leading-6 text-fault">{rowError}</p>}
          {unsavedDraft && (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-4 rounded-[10px] border border-line p-4">
              <div className="min-w-0 flex-1">
                <h3 className="text-[15px] font-semibold text-ink [overflow-wrap:anywhere]">{harnessMeta.name}</h3>
                <p className="mt-1 text-[12px] text-ink-mute">{!dirty ? "Open now · it's saved here once you change it." : saveState === "error" ? "Not saved yet — the local engine is unreachable. It saves as soon as it can." : "Saving…"}</p>
              </div>
              <button type="button" onClick={() => setStudioView("editor")} className={secondary}>Continue editing <ArrowRight size={14} aria-hidden /></button>
            </div>
          )}
          {loaded && !listError && items.length === 0 && !unsavedDraft && (
            <p className="mt-4 text-[13px] leading-6 text-ink-mute">Nothing saved yet. A new harness is saved here as soon as you edit it.</p>
          )}
          {items.length > 0 && (
            <ul className="mt-4 divide-y divide-line rounded-[10px] border border-line">
              {items.map((item) => {
                const open = item.id === harnessMeta.id;
                return (
                  <li key={item.id} className="flex flex-wrap items-center gap-3 p-4">
                    {confirmId === item.id ? (
                      <div role="group" aria-label={`Delete ${item.name}`} className="flex w-full flex-wrap items-center justify-between gap-3"
                        onKeyDown={(e) => { if (e.key === "Escape") cancelDelete(item.id); }}>
                        <p className="min-w-0 flex-1 text-[13px] text-ink [overflow-wrap:anywhere]">Delete “{item.name}” from this device? This can’t be undone.</p>
                        <div className="flex gap-2">
                          <button type="button" autoFocus onClick={() => cancelDelete(item.id)} className={secondary}>Cancel</button>
                          <button type="button" onClick={() => void remove(item.id)} className={secondary + " text-fault"}>Delete</button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="min-w-0 flex-1">
                          <h3 className="text-[15px] font-semibold text-ink [overflow-wrap:anywhere]">{item.name}</h3>
                          <p className="mt-1 text-[12px] text-ink-mute">
                            {open ? (saveState === "saving" ? "Open · saving…" : saveState === "error" ? "Open · last changes not saved" : "Open now") : edited(item.updated_at)}
                          </p>
                        </div>
                        <button type="button" aria-label={`${open ? "Continue editing" : "Open"} ${item.name}`} disabled={isRunning && !open} onClick={() => (open ? setStudioView("editor") : void openSaved(item.id))} className={secondary}>
                          {open ? "Continue editing" : "Open"} <ArrowRight size={14} aria-hidden />
                        </button>
                        <button type="button" data-delete-for={item.id} aria-label={`Delete ${item.name}`} title="Delete" disabled={isRunning && open}
                          onClick={() => setConfirmId(item.id)} className={secondary + " w-9 px-0"}>
                          <Trash2 size={14} aria-hidden />
                        </button>
                      </>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section aria-labelledby="starting-points" className="pt-7">
          <h2 id="starting-points" className="text-[14px] font-semibold text-ink">Starting points</h2>
          <p className="mt-1 text-[12px] leading-5 text-ink-mute">
            Choose a small example or explore the bundled framework. Your work stays saved above.
          </p>
          <div className="mt-4 divide-y divide-line rounded-[10px] border border-line">
            <article className="flex flex-col items-start gap-4 p-5 md:flex-row md:items-center">
              <Workflow size={21} strokeWidth={1.5} aria-hidden className="flex-none text-ink-faint" />
              <div className="min-w-0 flex-1">
                <p className="text-[11px] text-ink-faint">OpenHarness sample</p>
                <h3 className="mt-1 text-[15px] font-semibold text-ink">Agent + review</h3>
                <p className="mt-2 max-w-[540px] text-[13px] leading-6 text-ink-mute">Agent → review gate → human approval. Three nodes, configured for mock runs.</p>
              </div>
              <button type="button" disabled={loading || isRunning} className={secondary} onClick={() => {
                const sample = HARNESS_PRESETS.find((p) => p.id === "minimal-gate");
                if (sample) void startFresh(() => openStudioPreset(sample));
              }}>Open sample <ArrowRight size={14} aria-hidden /></button>
            </article>
            <article className="flex flex-col items-start gap-4 p-5 md:flex-row md:items-center">
              <Workflow size={21} strokeWidth={1.5} aria-hidden className="flex-none text-ink-faint" />
              <div className="min-w-0 flex-1">
                <p className="text-[11px] text-ink-faint">skills-framework · bundled snapshot</p>
                <h3 className="mt-1 text-[15px] font-semibold text-ink">OpenHarness Agile</h3>
                <p className="mt-2 max-w-[540px] text-[13px] leading-6 text-ink-mute">Includes agent profiles and harness guidance. The graph is an adaptation, not the complete framework workflow.</p>
              </div>
              <button type="button" disabled={loading || isRunning} className={secondary} onClick={() => void startFresh(openFramework)}>
                {loading ? "Opening…" : "Open framework"} <ArrowRight size={14} aria-hidden />
              </button>
            </article>
          </div>
          {error && <p role="alert" className="mt-3 text-[13px] leading-6 text-fault">{error}</p>}
        </section>
      </div>
    </section>
  );
}
