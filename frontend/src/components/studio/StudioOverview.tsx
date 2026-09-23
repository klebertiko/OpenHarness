"use client";
import { useEffect, useRef, useState } from "react";
import { ArrowRight, FolderOpen, Plus, Workflow } from "lucide-react";
import { useCanvasStore } from "@/store/canvasStore";
import { useShellStore } from "@/components/shell/shellStore";
import { newStudioHarness, openBundledHarness, openStudioPreset } from "@/lib/studio";
import { HARNESS_PRESETS } from "@/lib/templates";

const secondary = "inline-flex h-9 flex-none items-center justify-center gap-2 whitespace-nowrap rounded-control border border-line bg-sub-100 px-3 text-[12px] font-medium text-ink transition-colors hover:bg-sub-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-signal disabled:opacity-50";

export function StudioOverview() {
  const { harnessMeta, nodes, isRunning } = useCanvasStore();
  const { studioHasDraft, setStudioView, setLibraryOpen } = useShellStore();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);

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
            <button type="button" onClick={newStudioHarness} disabled={loading || isRunning} className="inline-flex h-9 items-center justify-center gap-2 whitespace-nowrap rounded-control bg-signal px-3 text-[12px] font-medium text-signal-ink transition-colors hover:bg-signal-deep focus-visible:outline focus-visible:outline-2 focus-visible:outline-signal disabled:opacity-50">
              <Plus size={14} aria-hidden /> New harness
            </button>
            <button type="button" onClick={() => setLibraryOpen(true)} disabled={loading || isRunning} className={secondary}>
              <FolderOpen size={14} aria-hidden /> Open .ohm
            </button>
          </div>
        </header>

        {isRunning && <p role="status" className="mt-4 text-[13px] leading-6 text-ink-mute">A run is in progress. Continue editing to inspect or stop it before opening another harness.</p>}

        {studioHasDraft && (
          <section aria-label="Current draft" className="border-b border-line py-6">
            <p className="text-[11px] font-medium text-ink-faint">Current draft · this session</p>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-4">
              <div className="min-w-0 flex-1">
                <h2 className="text-[16px] font-semibold text-ink [overflow-wrap:anywhere]">{harnessMeta.name}</h2>
                <p className="mt-1 text-[12px] text-ink-mute">{nodes.length} nodes · export an OHM file to keep a portable copy.</p>
              </div>
              <button type="button" disabled={loading} onClick={() => setStudioView("editor")} className={secondary}>
                Continue editing <ArrowRight size={14} aria-hidden />
              </button>
            </div>
          </section>
        )}

        <section aria-labelledby="starting-points" className="pt-7">
          <h2 id="starting-points" className="text-[14px] font-semibold text-ink">Starting points</h2>
          <p className="mt-1 text-[12px] leading-5 text-ink-mute">
            {studioHasDraft ? "Opening a starting point replaces the current draft. Export it first if you want to keep it." : "Choose a small example or explore the bundled framework."}
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
                if (sample) openStudioPreset(sample);
              }}>Open sample <ArrowRight size={14} aria-hidden /></button>
            </article>
            <article className="flex flex-col items-start gap-4 p-5 md:flex-row md:items-center">
              <Workflow size={21} strokeWidth={1.5} aria-hidden className="flex-none text-ink-faint" />
              <div className="min-w-0 flex-1">
                <p className="text-[11px] text-ink-faint">skills-framework · bundled snapshot</p>
                <h3 className="mt-1 text-[15px] font-semibold text-ink">OpenHarness Agile</h3>
                <p className="mt-2 max-w-[540px] text-[13px] leading-6 text-ink-mute">Includes agent profiles and harness guidance. The graph is an adaptation, not the complete framework workflow.</p>
              </div>
              <button type="button" disabled={loading || isRunning} className={secondary} onClick={() => void openFramework()}>
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
