"use client";
/* Hallmark · genre: modern-minimal editorial workspace · macrostructure: Graph Workshop overview
   (describe-first hero → document list + starting-points rail) · design-system: design.md · designed-as-app */
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { ArrowRight, FileText, FolderOpen, Plus, Trash2, Workflow } from "lucide-react";
import { useCanvasStore } from "@/store/canvasStore";
import { useShellStore } from "@/components/shell/shellStore";
import { newStudioHarness, openBundledHarness, openStudioExample, openStudioPreset } from "@/lib/studio";
import { fetchStudioExamples, type StudioExample } from "@/lib/studioExamples";
import { HARNESS_PRESETS } from "@/lib/templates";
import { discardStudioChanges, flushAutosave, hasStudioDraft, openSavedHarness, removeSavedHarness, useStudioDocsStore } from "@/lib/studioDocuments";
import { formatRelativeTime } from "@/lib/time";
import { COPILOT_ENABLED } from "@/lib/features";
import { startCopilotFromOverview } from "@/lib/copilotEntry";

const focusRing = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal";
const control = `inline-flex h-9 flex-none items-center justify-center gap-2 whitespace-nowrap rounded-control px-3 text-[12px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${focusRing}`;
const primary = `${control} bg-signal text-signal-ink hover:bg-signal-deep`;
const secondary = `${control} border border-line bg-sub-100 text-ink hover:bg-sub-200`;
const quiet = `${control} text-ink-dim hover:bg-sub-200 hover:text-ink`;
const PROMPT_LIMIT = 2000;
const DRAFT_ROW = "__draft__";

// The engine stores naive UTC timestamps; read them as UTC, not local time.
function edited(iso: string | null | undefined): string {
  const utc = iso && !/(z|[+-]\d\d:?\d\d)$/i.test(iso) ? iso + "Z" : iso;
  const rel = formatRelativeTime(utc);
  return rel === "just now" || rel === "—" ? `Edited ${rel}` : `Edited ${rel} ago`;
}

/** A row in "Your harnesses": a document name with one line of state beneath it. */
function DocumentLine({ name, status, live }: { name: string; status: string; live?: boolean }) {
  return (
    <div className="flex min-w-[min(100%,12rem)] flex-1 items-start gap-3">
      <FileText size={16} strokeWidth={1.6} aria-hidden className="mt-0.5 flex-none text-ink-faint" />
      <div className="min-w-0 flex-1">
        <h3 className="t-title text-ink [overflow-wrap:anywhere]">{name}</h3>
        <div className="mt-1 flex items-center gap-1.5 text-[12px] leading-5 text-ink-mute">
          {live && <span aria-hidden className="h-1.5 w-1.5 flex-none rounded-full bg-signal" />}
          <p className="min-w-0">{status}</p>
        </div>
      </div>
    </div>
  );
}

export function StudioOverview() {
  const { harnessMeta, nodes, edges, isRunning } = useCanvasStore();
  const { setStudioView, setLibraryOpen } = useShellStore();
  const { items, loaded, error: listError, saveState, dirty, refresh } = useStudioDocsStore();
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [rowError, setRowError] = useState("");
  const unsavedDraft = !harnessMeta.id && hasStudioDraft({ nodes, edges, harnessMeta });
  useEffect(() => { void refresh(); }, [refresh]);
  // Every example the engine's catalog returns, beyond the two fixed cards below.
  const [extraExamples, setExtraExamples] = useState<StudioExample[]>([]);
  useEffect(() => {
    let alive = true;
    void fetchStudioExamples().then(
      (all) => { if (alive) setExtraExamples(all.filter((e) => !e.presetId && !/^openharness\.default\b/.test(e.id))); },
      () => {},
    );
    return () => { alive = false; };
  }, []);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [prompt, setPrompt] = useState("");
  const [drafting, setDrafting] = useState(false);
  const [copilotError, setCopilotError] = useState("");
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
  const discardDraft = async () => {
    setRowError("");
    try { await discardStudioChanges(); setConfirmId(null); } catch (e) { setRowError((e as Error).message); }
  };
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

  const description = prompt.trim();
  const canDraft = description.length > 0 && !drafting && !isRunning && !loading;
  const draftWithCopilot = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!canDraft) return;
    setCopilotError("");
    setDrafting(true);
    try {
      await startCopilotFromOverview(description);
    } catch (err) {
      setCopilotError((err as Error).message || "Nilo could not start.");
    } finally {
      setDrafting(false);
    }
  };
  const onPromptKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== "Enter" || !(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    e.stopPropagation(); // Mod+Enter is also an app chord; here it only means "draft".
    void draftWithCopilot();
  };

  const startDisabled = loading || isRunning;
  const newHarness = (
    <button type="button" onClick={() => void startFresh(newStudioHarness)} disabled={startDisabled} className={COPILOT_ENABLED ? secondary : primary}>
      <Plus size={14} aria-hidden /> New harness
    </button>
  );
  const openOhm = (
    <button type="button" onClick={() => setLibraryOpen(true)} disabled={startDisabled} className={COPILOT_ENABLED ? quiet : secondary}>
      <FolderOpen size={14} aria-hidden /> Open .ohm
    </button>
  );
  const hasRows = items.length > 0 || unsavedDraft;

  return (
    <section aria-labelledby="studio-heading" className="h-full min-w-0 overflow-y-auto px-4 py-6 sm:px-8 sm:py-10">
      <div className="mx-auto w-full max-w-[1040px]">
        {COPILOT_ENABLED ? (
          <header className="max-w-[760px]">
            <h1 id="studio-heading" className="t-display text-[24px] text-ink [overflow-wrap:anywhere]">Harness Studio</h1>
            <p className="mt-2 text-[13px] leading-6 text-ink-mute">Say what the harness should do. Nilo drafts the graph; you review every change.</p>
            <form onSubmit={(e) => void draftWithCopilot(e)} className="oh-agent-composer mt-5 has-[textarea:focus-visible]:outline has-[textarea:focus-visible]:outline-2 has-[textarea:focus-visible]:outline-offset-2 has-[textarea:focus-visible]:outline-signal">
              <label htmlFor="studio-describe" className="sr-only">Describe the harness you want</label>
              <textarea
                id="studio-describe"
                value={prompt}
                onChange={(e) => { setPrompt(e.target.value); if (copilotError) setCopilotError(""); }}
                onKeyDown={onPromptKey}
                maxLength={PROMPT_LIMIT}
                rows={3}
                placeholder="Describe the harness you want… e.g. research a topic, draft a brief, then a review gate before a person approves."
                aria-describedby={copilotError ? "studio-describe-error" : undefined}
                className="block min-h-[88px] w-full resize-y rounded-t-[14px] bg-transparent px-4 pb-2 pt-4 text-[13px] leading-6 text-ink placeholder:text-ink-faint focus-visible:outline-none"
              />
              <div className="flex flex-wrap items-center gap-2 px-2.5 pb-2.5 pt-1">
                <div className="flex flex-wrap gap-2">{newHarness}{openOhm}</div>
                <div className="ml-auto flex items-center gap-3">
                  <span className="hidden text-[11px] text-ink-faint sm:inline">Ctrl ↵ to draft</span>
                  <button type="submit" disabled={!canDraft} className={primary}>
                    {drafting ? "Drafting…" : "Draft with Nilo"} <ArrowRight size={14} aria-hidden />
                  </button>
                </div>
              </div>
            </form>
            {copilotError && <p id="studio-describe-error" role="alert" className="mt-3 text-[13px] leading-6 text-fault">{copilotError}</p>}
          </header>
        ) : (
          <header className="flex flex-wrap items-end justify-between gap-x-8 gap-y-5">
            <div className="min-w-0 max-w-[560px]">
              <h1 id="studio-heading" className="t-display text-[24px] text-ink [overflow-wrap:anywhere]">Harness Studio</h1>
              <p className="mt-2 text-[13px] leading-6 text-ink-mute">Design a workflow. Connect its agents. Share it as OHM.</p>
            </div>
            <div className="flex flex-wrap gap-2">{newHarness}{openOhm}</div>
          </header>
        )}

        {isRunning && <p role="status" className="mt-5 text-[13px] leading-6 text-ink-mute">A run is in progress. Continue editing to inspect or stop it before opening another harness.</p>}

        <div className="mt-8 grid grid-cols-1 gap-10 border-t border-line pt-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,288px)] lg:gap-12">
          <section aria-labelledby="your-harnesses" className="min-w-0">
            <div className="flex items-baseline gap-2">
              <h2 id="your-harnesses" className="text-[14px] font-semibold text-ink">Your harnesses</h2>
              {items.length > 0 && <span className="t-meta text-ink-faint">{items.length}</span>}
            </div>
            <p className="mt-1 text-[12px] leading-5 text-ink-mute">Saved on this device as you edit. Export an OHM file to share a copy.</p>
            {listError && (
              <p role="alert" className="mt-4 rounded-[10px] border border-line px-4 py-4 text-[13px] leading-6 text-fault">
                {listError} <button type="button" className={`rounded-control underline underline-offset-2 ${focusRing}`} onClick={() => void refresh()}>Retry</button>
              </p>
            )}
            {rowError && <p role="alert" className="mt-3 text-[13px] leading-6 text-fault">{rowError}</p>}
            {!loaded && !listError && <p role="status" className="mt-4 text-[13px] leading-6 text-ink-faint">Loading your harnesses…</p>}
            {loaded && !listError && !hasRows && (
              <p className="mt-4 rounded-[10px] border border-dashed border-line px-4 py-5 text-[13px] leading-6 text-ink-mute">Nothing saved yet. A new harness is saved here as soon as you edit it.</p>
            )}
            {hasRows && (
              <ul aria-labelledby="your-harnesses" className="mt-4 divide-y divide-line overflow-hidden rounded-[10px] border border-line">
                {unsavedDraft && (
                  <li className="flex flex-wrap items-center gap-x-3 gap-y-2 bg-sub-100 px-4 py-3">
                    {confirmId === DRAFT_ROW ? (
                      <div role="group" aria-label={`Delete ${harnessMeta.name}`} className="flex w-full flex-wrap items-center justify-between gap-3"
                        onKeyDown={(e) => { if (e.key === "Escape") cancelDelete(DRAFT_ROW); }}>
                        <p className="min-w-0 flex-1 text-[13px] leading-6 text-ink [overflow-wrap:anywhere]">Delete the draft “{harnessMeta.name}”? It hasn’t been saved, so it’s gone for good.</p>
                        <div className="flex gap-2">
                          <button type="button" autoFocus onClick={() => cancelDelete(DRAFT_ROW)} className={secondary}>Cancel</button>
                          <button type="button" onClick={() => void discardDraft()} className={secondary + " text-fault"}>Delete</button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <DocumentLine
                          name={harnessMeta.name}
                          live
                          status={!dirty ? "Open now · it's saved here once you change it." : saveState === "error" ? "Not saved yet — the local engine is unreachable. It saves as soon as it can." : "Saving…"}
                        />
                        <div className="ml-auto flex flex-none gap-2">
                          <button type="button" aria-label={`Continue editing ${harnessMeta.name}`} onClick={() => setStudioView("editor")} className={secondary}>
                            Continue editing <ArrowRight size={14} aria-hidden />
                          </button>
                          <button type="button" data-delete-for={DRAFT_ROW} aria-label={`Delete ${harnessMeta.name}`} title="Delete draft" disabled={isRunning}
                            onClick={() => setConfirmId(DRAFT_ROW)} className={`${quiet} w-9 px-0 hover:text-fault`}>
                            <Trash2 size={14} aria-hidden />
                          </button>
                        </div>
                      </>
                    )}
                  </li>
                )}
                {items.map((item) => {
                  const open = item.id === harnessMeta.id;
                  return (
                    <li key={item.id} className={`flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 transition-colors ${open ? "bg-sub-100" : "hover:bg-sub-100"}`}>
                      {confirmId === item.id ? (
                        <div role="group" aria-label={`Delete ${item.name}`} className="flex w-full flex-wrap items-center justify-between gap-3"
                          onKeyDown={(e) => { if (e.key === "Escape") cancelDelete(item.id); }}>
                          <p className="min-w-0 flex-1 text-[13px] leading-6 text-ink [overflow-wrap:anywhere]">Delete “{item.name}” from this device? This can’t be undone.</p>
                          <div className="flex gap-2">
                            <button type="button" autoFocus onClick={() => cancelDelete(item.id)} className={secondary}>Cancel</button>
                            <button type="button" onClick={() => void remove(item.id)} className={secondary + " text-fault"}>Delete</button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <DocumentLine
                            name={item.name}
                            live={open}
                            status={open ? (saveState === "saving" ? "Open · saving…" : saveState === "error" ? "Open · last changes not saved" : "Open now") : edited(item.updated_at)}
                          />
                          <div className="ml-auto flex flex-none gap-2">
                            <button type="button" aria-label={`${open ? "Continue editing" : "Open"} ${item.name}`} disabled={isRunning && !open} onClick={() => (open ? setStudioView("editor") : void openSaved(item.id))} className={secondary}>
                              {open ? "Continue editing" : "Open"} <ArrowRight size={14} aria-hidden />
                            </button>
                            <button type="button" data-delete-for={item.id} aria-label={`Delete ${item.name}`} title="Delete" disabled={isRunning && open}
                              onClick={() => setConfirmId(item.id)} className={`${quiet} w-9 px-0 hover:text-fault`}>
                              <Trash2 size={14} aria-hidden />
                            </button>
                          </div>
                        </>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <aside aria-labelledby="starting-points" className="min-w-0">
            <h2 id="starting-points" className="text-[14px] font-semibold text-ink">Starting points</h2>
            <p className="mt-1 text-[12px] leading-5 text-ink-mute">Open an example harness or the Agile Harness as an editable copy. Your work stays saved.</p>
            <div className="mt-4 grid grid-cols-1 gap-x-6 gap-y-6 sm:grid-cols-2 lg:grid-cols-1">
              <article className="flex flex-col items-start gap-3 border-t border-line pt-4">
                <div className="flex items-center gap-2">
                  <Workflow size={14} strokeWidth={1.6} aria-hidden className="flex-none text-ink-faint" />
                  <p className="text-[11px] text-ink-faint">Example harness</p>
                </div>
                <div className="min-w-0">
                  <h3 className="t-title text-ink">Agent + review</h3>
                  <p className="mt-1 text-[12px] leading-5 text-ink-mute">Agent → review gate → human approval. Three nodes, configured for mock runs.</p>
                </div>
                <button type="button" disabled={startDisabled} aria-label="Open Agent + review" className={`${secondary} mt-auto`} onClick={() => {
                  const sample = HARNESS_PRESETS.find((p) => p.id === "minimal-gate");
                  if (sample) void startFresh(() => openStudioPreset(sample));
                }}>Open harness <ArrowRight size={14} aria-hidden /></button>
              </article>
              <article className="flex flex-col items-start gap-3 border-t border-line pt-4">
                <div className="flex items-center gap-2">
                  <Workflow size={14} strokeWidth={1.6} aria-hidden className="flex-none text-ink-faint" />
                  <p className="text-[11px] text-ink-faint">Bundled harness</p>
                </div>
                <div className="min-w-0">
                  <h3 className="t-title text-ink">Agile Harness</h3>
                  <p className="mt-1 text-[12px] leading-5 text-ink-mute">Includes agent profiles and harness guidance. The graph is adapted from the skills-framework workflow, not the complete workflow.</p>
                </div>
                <button type="button" disabled={startDisabled} aria-label="Open Agile Harness" className={`${secondary} mt-auto`} onClick={() => void startFresh(openFramework)}>
                  {loading ? "Opening…" : "Open harness"} <ArrowRight size={14} aria-hidden />
                </button>
              </article>
              {extraExamples.map((ex) => (
                <article key={ex.id} className="flex flex-col items-start gap-3 border-t border-line pt-4">
                  <div className="flex items-center gap-2">
                    <Workflow size={14} strokeWidth={1.6} aria-hidden className="flex-none text-ink-faint" />
                    <p className="text-[11px] text-ink-faint">Example harness</p>
                  </div>
                  <div className="min-w-0">
                    <h3 className="t-title text-ink">{ex.name}</h3>
                    {ex.description && <p className="mt-1 line-clamp-3 text-[12px] leading-5 text-ink-mute">{ex.description}</p>}
                  </div>
                  <button type="button" disabled={startDisabled} aria-label={`Open ${ex.name}`} className={`${secondary} mt-auto`}
                    onClick={() => void startFresh(() => openStudioExample(ex))}>
                    Open harness <ArrowRight size={14} aria-hidden />
                  </button>
                </article>
              ))}
            </div>
            {error && <p role="alert" className="mt-3 text-[13px] leading-6 text-fault">{error}</p>}
          </aside>
        </div>
      </div>
    </section>
  );
}
