"use client";
/* The Studio editor's header: who this harness is (name, origin, saved or not)
   on the first row, and every file action on the second, grouped by intent.
   Save as is the primary action; destructive ones sit apart and always confirm. */
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import {
  ArrowLeft, ChevronDown, Download, FilePlus, Layers, MessageSquare, Save, SaveAll, Sparkles, Trash2, Undo2, Upload,
} from "lucide-react";
import { useCanvasStore } from "@/store/canvasStore";
import { useCopilotStore } from "@/store/copilotStore";
import { useHarnessSessionStore } from "@/store/harnessSessionStore";
import { useShellStore } from "@/components/shell/shellStore";
import { saveOhmFile } from "@/lib/ohmFile";
import { composeStudioBundle, importOhmText, newStudioHarness, openStudioExample, useStudioInChat } from "@/lib/studio";
import {
  discardStudioChanges, removeSavedHarness, saveHarnessAs, saveHarnessNow, useStudioDocsStore,
} from "@/lib/studioDocuments";
import { fetchStudioExamples, studioOrigin, type StudioExample } from "@/lib/studioExamples";

const focusRing = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal";
const base = `inline-flex h-8 flex-none items-center justify-center gap-1.5 whitespace-nowrap rounded-control px-2.5 text-[12px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${focusRing}`;
const primary = `${base} bg-signal text-signal-ink hover:bg-signal-deep`;
const secondary = `${base} border border-line bg-sub-100 text-ink hover:bg-sub-200`;
const quiet = `${base} text-ink-dim hover:bg-sub-200 hover:text-ink`;
const danger = `${base} text-ink-dim hover:bg-sub-200 hover:text-fault`;

const ORIGIN_LABEL = { saved: "Saved harness", example: "Example", draft: "Draft" } as const;

function Group({ label, children }: { label: string; children: ReactNode }) {
  return <div role="group" aria-label={label} className="flex flex-wrap items-center gap-1">{children}</div>;
}
const Divider = () => <span aria-hidden className="mx-1 hidden h-5 w-px bg-line sm:inline-block" />;

export function StudioActionsBar() {
  const { harnessMeta, nodes, isRunning } = useCanvasStore();
  const bundleId = useHarnessSessionStore((s) => s.activeBundle?.manifest?.id);
  const { saveState, dirty } = useStudioDocsStore();
  const setStudioView = useShellStore((s) => s.setStudioView);
  const openCopilot = useCopilotStore((s) => s.openCopilot);

  const origin = studioOrigin(harnessMeta.id, bundleId);
  const [pending, setPending] = useState<null | "saveas" | "discard" | "delete">(null);
  const [copyName, setCopyName] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [examples, setExamples] = useState<StudioExample[] | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => { if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false); };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [menuOpen]);

  const status =
    saveState === "saving" ? "Saving…"
      : saveState === "error" ? "Not saved — engine unreachable"
        : dirty ? "Unsaved changes"
          : harnessMeta.id ? "Saved" : "Not saved yet";
  const unsaved = status !== "Saved";

  const run = async (action: () => Promise<unknown>, done?: string) => {
    setBusy(true);
    setNote(null);
    try {
      await action();
      if (done) setNote({ tone: "ok", text: done });
      setPending(null);
    } catch (e) {
      setNote({ tone: "error", text: (e as Error).message || "That didn't work." });
    } finally {
      setBusy(false);
    }
  };

  const toggleExamples = () => {
    const next = !menuOpen;
    setMenuOpen(next);
    if (next && !examples) void fetchStudioExamples().then(setExamples, () => setExamples([]));
  };
  const chooseExample = (example: StudioExample) => {
    setMenuOpen(false);
    setNote(null);
    try {
      openStudioExample(example);
      setNote({ tone: "ok", text: `Opened a copy of ${example.name}. Save to keep it.` });
    } catch (e) {
      setNote({ tone: "error", text: (e as Error).message });
    }
  };

  const startSaveAs = () => {
    setCopyName(harnessMeta.id ? `${harnessMeta.name} copy` : harnessMeta.name);
    setPending("saveas");
    setNote(null);
  };
  const submitSaveAs = (e: FormEvent) => {
    e.preventDefault();
    void run(() => saveHarnessAs(copyName), `Saved as “${copyName.trim()}”`);
  };

  const onImport = async (file: File) => {
    setBusy(true);
    setNote(null);
    const result = await importOhmText(await file.text());
    setNote(result.ok ? { tone: "ok", text: `Imported ${result.name}. Save to keep it.` } : { tone: "error", text: result.error });
    setBusy(false);
  };
  const onExport = () => run(async () => {
    const res = await saveOhmFile(composeStudioBundle());
    if (res.status === "cancelled") throw new Error("Export cancelled.");
  }, "Exported .ohm");

  const locked = isRunning || busy;
  const deleteLabel = origin === "draft" ? "Delete draft" : "Delete";
  const canDelete = origin !== "example";
  const canDiscard = origin !== "saved" || dirty || saveState === "error";
  const confirmAction = () => {
    if (pending === "discard" || origin !== "saved") return run(discardStudioChanges);
    return run(() => removeSavedHarness(harnessMeta.id!));
  };

  return (
    <div className="flex-none border-b border-line bg-sub-100">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 pt-2">
        <button type="button" onClick={() => setStudioView("overview")} className={quiet}>
          <ArrowLeft size={14} aria-hidden /> Back to Studio
        </button>
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2.5 gap-y-1">
          <h2 className="min-w-0 truncate text-[13px] font-semibold text-ink [overflow-wrap:anywhere]">{harnessMeta.name}</h2>
          <span className="rounded-control border border-line px-1.5 py-0.5 text-[11px] text-ink-mute">{ORIGIN_LABEL[origin]}</span>
          <span role="status" className={`inline-flex items-center gap-1.5 text-[12px] ${saveState === "error" ? "text-fault" : "text-ink-mute"}`}>
            <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${unsaved ? "bg-ink-faint" : "bg-signal"}`} />
            {status}
          </span>
        </div>
        <button type="button" onClick={openCopilot} className={secondary}><Sparkles size={14} aria-hidden /> Ask Nilo</button>
        <button type="button" onClick={useStudioInChat} disabled={nodes.length === 0 || isRunning} className={secondary}>
          <MessageSquare size={14} aria-hidden /> Use in chat
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-x-1 gap-y-2 px-3 py-2">
        <Group label="File">
          <button type="button" onClick={() => void run(async () => newStudioHarness())} disabled={locked} className={quiet}>
            <FilePlus size={14} aria-hidden /> New
          </button>
          <div ref={menuRef} className="relative">
            <button type="button" aria-haspopup="menu" aria-expanded={menuOpen} onClick={toggleExamples} disabled={locked} className={quiet}>
              <Layers size={14} aria-hidden /> Open example <ChevronDown size={12} aria-hidden />
            </button>
            {menuOpen && (
              <div role="menu" aria-label="Examples"
                onKeyDown={(e) => { if (e.key === "Escape") setMenuOpen(false); }}
                className="absolute left-0 top-full z-40 mt-1 w-[300px] max-w-[85vw] overflow-hidden rounded-[10px] border border-line bg-sub-100 py-1 shadow-lg">
                {!examples && <p role="status" className="px-3 py-2 text-[12px] text-ink-mute">Loading examples…</p>}
                {examples?.length === 0 && <p className="px-3 py-2 text-[12px] text-ink-mute">No examples available.</p>}
                {examples?.map((ex) => (
                  <button key={ex.id} type="button" role="menuitem" onClick={() => chooseExample(ex)}
                    className={`block w-full px-3 py-2 text-left hover:bg-sub-200 ${focusRing}`}>
                    <span className="block text-[12px] font-medium text-ink">{ex.name}</span>
                    {ex.description && <span className="mt-0.5 line-clamp-2 block text-[11px] leading-4 text-ink-mute">{ex.description}</span>}
                  </button>
                ))}
                <p className="border-t border-line-soft px-3 py-2 text-[11px] text-ink-faint">Opens an editable copy; the example itself is never changed.</p>
              </div>
            )}
          </div>
          <button type="button" onClick={() => fileRef.current?.click()} disabled={locked} className={quiet}>
            <Upload size={14} aria-hidden /> Import
          </button>
          <input ref={fileRef} type="file" accept=".ohm,.oharness,application/json" className="hidden" aria-label="Import .ohm file" disabled={locked}
            onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void onImport(f); }} />
          <button type="button" onClick={() => void onExport()} disabled={busy} className={quiet}>
            <Download size={14} aria-hidden /> Export
          </button>
        </Group>

        <span className="flex-1" />

        <Group label="Remove">
          <button type="button" onClick={() => { setPending("discard"); setNote(null); }} disabled={locked || !canDiscard} className={danger}>
            <Undo2 size={14} aria-hidden /> Discard
          </button>
          {canDelete && (
            <button type="button" onClick={() => { setPending("delete"); setNote(null); }} disabled={locked} className={danger}>
              <Trash2 size={14} aria-hidden /> {deleteLabel}
            </button>
          )}
        </Group>
        <Divider />
        <Group label="Save">
          <button type="button" onClick={() => void run(saveHarnessNow, "Saved")} disabled={locked} className={secondary}>
            <Save size={14} aria-hidden /> Save
          </button>
          <button type="button" onClick={startSaveAs} disabled={locked} className={primary}>
            <SaveAll size={14} aria-hidden /> Save as…
          </button>
        </Group>
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
      {note && (
        <p role={note.tone === "error" ? "alert" : "status"} className={`border-t border-line-soft px-3 py-1.5 text-[12px] ${note.tone === "error" ? "text-fault" : "text-ink-mute"}`}>
          {note.text}
        </p>
      )}
    </div>
  );
}
