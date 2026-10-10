"use client";
/* The Studio editor's one header. It answers, left to right: where am I and what
   is this harness (back, name, origin, saved or not), what can I do to the file
   (File menu, Save, undo/redo), can it run (readiness), who can help (Nilo), and
   run it (Run / Stop with its mode). Every action lives here exactly once; the
   command palette and the keyboard call the same functions. Confirmations that
   need a sentence or a field open as a row under the bar. */
import { useEffect, useState, type FormEvent } from "react";
import {
  ArrowLeft, ChevronDown, Download, FilePlus, FileText, Layers, Redo2, Save, SaveAll, Sparkles, Trash2, Undo2, Upload, X,
} from "lucide-react";
import { Menu, MenuItem, MenuSeparator } from "@/components/ui/Menu";
import { chordCaps, useIsMac } from "@/components/shell/keys";
import { useShellStore } from "@/components/shell/shellStore";
import { useCanvasStore } from "@/store/canvasStore";
import { useCopilotStore } from "@/store/copilotStore";
import { useHarnessSessionStore } from "@/store/harnessSessionStore";
import { newStudioHarness, openStudioExample } from "@/lib/studio";
import { discardStudioChanges, removeSavedHarness, saveHarnessAs, useStudioDocsStore } from "@/lib/studioDocuments";
import { fetchStudioExamples, studioOrigin, type StudioExample } from "@/lib/studioExamples";
import { exportOhm, pickAndImport, saveNow, useStudioFileStore } from "@/lib/studioFileActions";
import { CheckPanel } from "./CheckPanel";
import { RunControl } from "./RunControl";
import { useReadinessCheck, useReadinessStore } from "./readinessStore";
import { useStudioHeaderStore } from "./studioHeaderStore";

const focusRing = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal";
const base = `inline-flex h-8 flex-none items-center justify-center gap-1.5 whitespace-nowrap rounded-control px-2.5 text-[12px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${focusRing}`;
const primary = `${base} bg-signal text-signal-ink hover:bg-signal-deep`;
const secondary = `${base} border border-line bg-sub-100 text-ink hover:bg-sub-200`;
const quiet = `${base} text-ink-dim hover:bg-sub-200 hover:text-ink`;
const icon = `inline-flex h-8 w-8 flex-none items-center justify-center rounded-control text-ink-dim transition-colors hover:bg-sub-200 hover:text-ink disabled:cursor-not-allowed disabled:opacity-35 ${focusRing}`;

const ORIGIN_LABEL = { saved: "Saved harness", example: "Example", draft: "Draft" } as const;

const PILL_TONE = {
  empty: "text-ink-mute",
  checking: "text-ink-mute",
  ready: "text-signal",
  review: "text-warn",
  problems: "text-fault",
  offline: "text-fault",
} as const;

function ReadinessPill() {
  const summary = useReadinessCheck();
  const panel = useReadinessStore((s) => s.panel);
  const openPanel = useReadinessStore((s) => s.openPanel);
  const closePanel = useReadinessStore((s) => s.closePanel);
  const recheck = useReadinessStore((s) => s.recheck);
  const open = panel === "problems";
  return (
    <button
      type="button"
      disabled={summary.state === "empty"}
      aria-expanded={open}
      title={summary.state === "offline" ? "Check again" : "Show what the check found"}
      onClick={() => {
        if (summary.state === "offline") recheck();
        else if (open) closePanel();
        else openPanel("problems");
      }}
      className={`${base} border border-line bg-sub-100 hover:bg-sub-200 ${PILL_TONE[summary.state]}`}
    >
      <span aria-hidden className={`h-1.5 w-1.5 rounded-full bg-current ${summary.state === "checking" ? "motion-safe:animate-pulse" : ""}`} />
      {summary.label}
    </button>
  );
}

export function StudioHeader() {
  const mac = useIsMac();
  const harnessMeta = useCanvasStore((s) => s.harnessMeta);
  const setHarnessMeta = useCanvasStore((s) => s.setHarnessMeta);
  const isRunning = useCanvasStore((s) => s.isRunning);
  const undo = useCanvasStore((s) => s.undo);
  const redo = useCanvasStore((s) => s.redo);
  const canUndo = useCanvasStore((s) => s.canUndo());
  const canRedo = useCanvasStore((s) => s.canRedo());
  const bundleId = useHarnessSessionStore((s) => s.activeBundle?.manifest?.id);
  const { saveState, dirty } = useStudioDocsStore();
  const setStudioView = useShellStore((s) => s.setStudioView);
  const openCopilot = useCopilotStore((s) => s.openCopilot);
  const { notice, busy: fileBusy, dismiss } = useStudioFileStore();
  const { pending, setPending } = useStudioHeaderStore();

  const origin = studioOrigin(harnessMeta.id, bundleId);
  const [copyName, setCopyName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [examples, setExamples] = useState<StudioExample[] | null>(null);
  const [examplesOpen, setExamplesOpen] = useState(false);

  const status =
    saveState === "saving" ? "Saving…"
      : saveState === "error" ? "Not saved — engine unreachable"
        : dirty ? "Unsaved changes"
          : harnessMeta.id ? "Saved" : "Not saved yet";
  const unsaved = status !== "Saved";
  const locked = isRunning || busy || fileBusy;
  const savable = unsaved && saveState !== "saving";

  // The palette can ask for Save as; give it the name the File menu would.
  useEffect(() => {
    if (pending === "saveas") setCopyName(harnessMeta.id ? `${harnessMeta.name} copy` : harnessMeta.name);
    // Only when the form opens; typing must not reset the field.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending]);
  useEffect(() => () => setPending(null), [setPending]);

  const attempt = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await action();
      setPending(null);
    } catch (e) {
      setError((e as Error).message || "That didn't work.");
    } finally {
      setBusy(false);
    }
  };

  const toggleExamples = () => {
    const next = !examplesOpen;
    setExamplesOpen(next);
    if (next && !examples) void fetchStudioExamples().then(setExamples, () => setExamples([]));
  };
  const chooseExample = (example: StudioExample) => {
    setExamplesOpen(false);
    try {
      openStudioExample(example);
      useStudioFileStore.getState().notify("ok", `Opened a copy of ${example.name}. Save to keep it.`);
    } catch (e) {
      useStudioFileStore.getState().notify("error", (e as Error).message);
    }
  };
  const submitSaveAs = (e: FormEvent) => {
    e.preventDefault();
    const name = copyName.trim();
    void attempt(async () => {
      await saveHarnessAs(name);
      useStudioFileStore.getState().notify("ok", `Saved as “${name}”`);
    });
  };

  const deleteLabel = origin === "draft" ? "Delete draft" : "Delete";
  const canDelete = origin !== "example";
  const canDiscard = origin !== "saved" || dirty || saveState === "error";
  const confirmAction = () => {
    if (pending === "discard" || origin !== "saved") return attempt(discardStudioChanges);
    return attempt(() => removeSavedHarness(harnessMeta.id!));
  };
  const exportCaps = chordCaps("Mod+Shift+E", mac).join(" ");
  const saveCaps = chordCaps("Mod+S", mac).join(" ");

  return (
    <div className="flex-none border-b border-line bg-sub-100">
      <div role="group" aria-label="Harness" className="flex min-h-[48px] flex-wrap items-center gap-x-2 gap-y-1 px-3 py-1.5">
        <div className="flex min-w-[15rem] flex-1 items-center gap-2">
          <button type="button" aria-label="Back to Studio" title="Back to the Studio library" onClick={() => setStudioView("overview")} className={quiet}>
            <ArrowLeft size={14} aria-hidden /> <span className="max-md:sr-only">Studio</span>
          </button>
          <span className="text-ink-faint" aria-hidden>/</span>
          <input
            value={harnessMeta.name}
            onChange={(e) => setHarnessMeta({ name: e.target.value })}
            spellCheck={false}
            aria-label="Harness name"
            title="Rename this harness"
            className="h-8 w-full min-w-[6rem] max-w-[260px] rounded-control border border-transparent bg-transparent px-2 text-[13px] font-semibold text-ink outline-none transition-colors hover:border-line hover:bg-sub-200 focus:border-signal focus:bg-sub-200"
          />
          <span className="flex-none rounded-control border border-line px-1.5 py-0.5 text-[11px] text-ink-mute max-lg:hidden">{ORIGIN_LABEL[origin]}</span>
          <span role="status" className={`inline-flex flex-none items-center gap-1.5 text-[12px] ${saveState === "error" ? "text-fault" : "text-ink-mute"}`}>
            <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${unsaved ? "bg-ink-faint" : "bg-signal"}`} />
            {status}
          </span>
        </div>

        <div className="flex flex-none flex-wrap items-center gap-1">
          <Menu label="File" trigger={<><FileText size={14} aria-hidden /> File <ChevronDown size={12} aria-hidden /></>} triggerClassName={quiet}>
            <MenuItem icon={<FilePlus size={14} />} disabled={locked} onSelect={() => { setError(""); newStudioHarness(); }}>New</MenuItem>
            <MenuItem icon={<Layers size={14} />} disabled={locked} keepOpen expanded={examplesOpen} hint={<ChevronDown size={12} />} onSelect={toggleExamples}>
              Open example
            </MenuItem>
            {examplesOpen && (
              <div role="group" aria-label="Examples" className="border-y border-line-soft bg-sub-000/40 py-1">
                {!examples && <p role="status" className="px-9 py-1.5 text-[12px] text-ink-mute">Loading examples…</p>}
                {examples?.length === 0 && <p className="px-9 py-1.5 text-[12px] text-ink-mute">No examples available.</p>}
                {examples?.map((ex) => (
                  <MenuItem key={ex.id} onSelect={() => chooseExample(ex)}>
                    <span className="block">{ex.name}</span>
                    {ex.description && <span className="line-clamp-2 block text-[11px] font-normal leading-4 text-ink-mute">{ex.description}</span>}
                  </MenuItem>
                ))}
                <p className="px-9 py-1 text-[11px] text-ink-faint">Opens an editable copy; the example itself is never changed.</p>
              </div>
            )}
            <MenuItem icon={<Upload size={14} />} disabled={locked} hint=".ohm" onSelect={() => void pickAndImport()}>Import</MenuItem>
            <MenuItem icon={<Download size={14} />} disabled={busy || fileBusy} hint={exportCaps} onSelect={() => void exportOhm()}>Export</MenuItem>
            <MenuSeparator />
            <MenuItem icon={<SaveAll size={14} />} disabled={locked} onSelect={() => { setError(""); setPending("saveas"); }}>Save as…</MenuItem>
            <MenuSeparator />
            <MenuItem icon={<Undo2 size={14} />} danger disabled={locked || !canDiscard} onSelect={() => { setError(""); setPending("discard"); }}>Discard</MenuItem>
            {canDelete && <MenuItem icon={<Trash2 size={14} />} danger disabled={locked} onSelect={() => { setError(""); setPending("delete"); }}>{deleteLabel}</MenuItem>}
          </Menu>

          <button type="button" aria-label="Save" title={`Save now · ${saveCaps}`} disabled={locked || !savable} onClick={() => void saveNow()} className={secondary}>
            <Save size={14} aria-hidden /> <span className="max-md:sr-only">Save</span>
          </button>

          <span className="mx-0.5 h-5 w-px bg-line max-md:hidden" aria-hidden />
          <button type="button" aria-label="Undo" title={`Undo · ${chordCaps("Mod+Z", mac).join(" ")}`} disabled={isRunning || !canUndo} onClick={undo} className={icon}>
            <Undo2 size={15} aria-hidden />
          </button>
          <button type="button" aria-label="Redo" title={`Redo · ${chordCaps("Mod+Shift+Z", mac).join(" ")}`} disabled={isRunning || !canRedo} onClick={redo} className={icon}>
            <Redo2 size={15} aria-hidden />
          </button>
          <span className="mx-0.5 h-5 w-px bg-line max-md:hidden" aria-hidden />

          <ReadinessPill />
          <button type="button" aria-label="Ask Nilo" title={`Ask Nilo · ${chordCaps("Mod+I", mac).join(" ")}`} onClick={openCopilot} className={secondary}>
            <Sparkles size={14} aria-hidden /> <span className="max-md:sr-only">Ask Nilo</span>
          </button>
          <RunControl />
        </div>
      </div>

      {pending === "saveas" && (
        <form onSubmit={submitSaveAs} className="flex flex-wrap items-center gap-2 border-t border-line-soft px-3 py-2">
          <label htmlFor="studio-copy-name" className="text-[12px] text-ink-mute">Save a copy as</label>
          <input id="studio-copy-name" aria-label="Name of the copy" value={copyName} autoFocus onChange={(e) => setCopyName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Escape") setPending(null); }}
            className="h-8 min-w-[12rem] max-w-[320px] flex-1 rounded-control border border-line bg-sub-200 px-2 text-[13px] text-ink outline-none focus:border-signal" />
          <button type="submit" disabled={busy || !copyName.trim()} className={primary}>Save copy</button>
          <button type="button" onClick={() => setPending(null)} className={quiet}>Cancel</button>
          <p className="basis-full text-[11px] text-ink-faint">
            Creates a new editable harness. {origin === "saved" ? "The original stays as it is." : "Bundled examples are never overwritten."}
          </p>
        </form>
      )}
      {(pending === "discard" || pending === "delete") && (
        <div role="group" aria-label={pending === "discard" ? "Confirm discard" : "Confirm delete"}
          onKeyDown={(e) => { if (e.key === "Escape") setPending(null); }}
          className="flex flex-wrap items-center gap-3 border-t border-line-soft px-3 py-2">
          <p className="min-w-0 flex-1 text-[13px] leading-6 text-ink [overflow-wrap:anywhere]">
            {pending === "discard"
              ? origin === "saved"
                ? `Discard the changes to “${harnessMeta.name}” and go back to the saved version?`
                : `Discard “${harnessMeta.name}”? It has not been saved, so it is gone for good.`
              : origin === "saved"
                ? `Delete “${harnessMeta.name}” from this device? This can’t be undone.`
                : `Delete the draft “${harnessMeta.name}”? It has not been saved, so it is gone for good.`}
          </p>
          <button type="button" autoFocus onClick={() => setPending(null)} className={secondary}>Cancel</button>
          <button type="button" disabled={busy} className={`${secondary} text-fault`} onClick={() => void confirmAction()}>
            {pending === "discard" ? "Discard" : "Delete"}
          </button>
        </div>
      )}
      {error && <p role="alert" className="border-t border-line-soft px-3 py-1.5 text-[12px] text-fault">{error}</p>}
      {notice && (
        <div role={notice.tone === "error" ? "alert" : "status"} className={`flex items-center gap-2 border-t border-line-soft px-3 py-1 text-[12px] ${notice.tone === "error" ? "text-fault" : "text-ink-mute"}`}>
          <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{notice.text}</span>
          <button type="button" aria-label="Dismiss" onClick={dismiss} className={`${icon} !h-6 !w-6`}><X size={13} aria-hidden /></button>
        </div>
      )}
      <CheckPanel />
    </div>
  );
}
