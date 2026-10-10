"use client";
import { create } from "zustand";
import { importGraphFile } from "./actions";
import { saveOhmFile } from "./ohmFile";
import { composeStudioBundle, importOhmText } from "./studio";
import { saveHarnessNow } from "./studioDocuments";
import { useCanvasStore } from "@/store/canvasStore";

/**
 * The Studio document verbs that touch a file or the disk, in one place.
 *
 * The header's File menu, the Save button, the command palette and the
 * keyboard chords all call these same functions, and all report through the
 * same notice — so an action has one implementation, one home in the UI, and
 * one way of saying how it went.
 */

export interface Notice {
  id: number;
  tone: "ok" | "error";
  text: string;
}

interface FileStore {
  notice: Notice | null;
  /** A file action is in flight (a Save dialog is open, a file is being read). */
  busy: boolean;
  notify: (tone: Notice["tone"], text: string) => void;
  dismiss: () => void;
}

const NOTICE_MS = 6000;
let noticeId = 0;
let noticeTimer: ReturnType<typeof setTimeout> | null = null;

export const useStudioFileStore = create<FileStore>((set) => ({
  notice: null,
  busy: false,
  // Good news clears itself. A failure stays until it is read and dismissed.
  notify: (tone, text) => {
    if (noticeTimer) clearTimeout(noticeTimer);
    const id = ++noticeId;
    set({ notice: { id, tone, text } });
    noticeTimer = tone === "ok"
      ? setTimeout(() => set((s) => (s.notice?.id === id ? { notice: null } : s)), NOTICE_MS)
      : null;
  },
  dismiss: () => {
    if (noticeTimer) clearTimeout(noticeTimer);
    noticeTimer = null;
    set({ notice: null });
  },
}));

const notify = (tone: Notice["tone"], text: string) => useStudioFileStore.getState().notify(tone, text);
const message = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback);

/** Run `work` as the one file action in flight; a second call while busy is ignored. */
async function exclusive(work: () => Promise<void>): Promise<void> {
  if (useStudioFileStore.getState().busy) return;
  useStudioFileStore.setState({ busy: true });
  try {
    await work();
  } finally {
    useStudioFileStore.setState({ busy: false });
  }
}

/** Save now. A harness with no record yet becomes one; a saved one is flushed. */
export async function saveNow(): Promise<void> {
  try {
    await saveHarnessNow();
    notify("ok", "Saved");
  } catch (e) {
    notify("error", message(e, "That didn't work."));
  }
}

/** Export the open harness as `.ohm` through the native Save dialog. */
export function exportOhm(): Promise<void> {
  return exclusive(async () => {
    try {
      const result = await saveOhmFile(composeStudioBundle());
      if (result.status === "cancelled") return;
      notify("ok", result.native ? `Saved to ${result.name}` : "Downloaded .ohm");
    } catch (e) {
      notify("error", message(e, "Export failed."));
    }
  });
}

const isLegacyGraph = (v: unknown): boolean =>
  typeof v === "object" && v !== null && !("manifest" in v)
  && Array.isArray((v as { nodes?: unknown }).nodes) && Array.isArray((v as { edges?: unknown }).edges);

/**
 * Open a file as a new harness. `.ohm` bundles are validated by the engine
 * first; the older plain graph JSON ("advanced" export) is still accepted so
 * retiring that second export format loses nobody's files. Nothing changes
 * unless the file is good, and nothing is replaced while a run is going.
 */
export function importFile(file: File): Promise<void> {
  return exclusive(async () => {
    if (useCanvasStore.getState().isRunning) return notify("error", "Stop the current run first.");
    try {
      const text = await file.text();
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        return notify("error", "That isn't a readable .ohm harness file.");
      }
      if (isLegacyGraph(parsed)) {
        return importGraphFile(text, file.name)
          ? notify("ok", `Imported ${useCanvasStore.getState().harnessMeta.name}. Save to keep it.`)
          : notify("error", "That graph file can't be opened as a harness.");
      }
      const result = await importOhmText(text);
      if (result.ok) notify("ok", `Imported ${result.name}. Save to keep it.`);
      else notify("error", result.error);
    } catch (e) {
      notify("error", message(e, "Import failed."));
    }
  });
}

/** Ask for a file, then import it. Used wherever Import has no button of its own (the palette). */
export function pickAndImport(): Promise<void> {
  return new Promise<void>((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".ohm,.oharness,.json,application/json";
    input.onchange = () => {
      const chosen = input.files?.[0];
      if (!chosen) return resolve();
      void importFile(chosen).then(resolve);
    };
    input.oncancel = () => resolve();
    input.click();
  });
}
