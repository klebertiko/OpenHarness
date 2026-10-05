"use client";
import { create } from "zustand";
import { useCanvasStore } from "@/store/canvasStore";
import { useShellStore } from "@/components/shell/shellStore";
import { useHarnessSessionStore, type HarnessBundle } from "@/store/harnessSessionStore";
import { api } from "./api";
import { composeBundleFromCanvas } from "./bundlesApi";
import type { HarnessGraph, HarnessMeta, HarnessNode } from "./types";

/**
 * Studio harnesses as documents, the way Figma files or n8n workflows behave:
 * every harness the person actually edits is saved to the local engine's
 * database on disk (`harness.db`), listed on the Studio overview, and can be
 * opened again or deleted. An untouched "Untitled harness" is not a document
 * and is never written. Opening a sample or saved harness does not write
 * anything until the person edits it (`markClean`).
 */

const DEFAULT_NAMES = new Set(["untitled harness"]);
const RUNTIME_NODE_KEYS = ["status", "output", "tokens", "latencyMs", "error"] as const;
const RUNTIME_EDGE_KEYS = ["live"] as const;
const AUTOSAVE_MS = 500;

type CanvasSnapshot = Pick<ReturnType<typeof useCanvasStore.getState>, "nodes" | "edges" | "harnessMeta">;
export type SaveState = "idle" | "saving" | "saved" | "error";

export function hasStudioDraft(s: CanvasSnapshot): boolean {
  return s.nodes.length > 0 || s.edges.length > 0
    || !DEFAULT_NAMES.has(s.harnessMeta.name.trim().toLowerCase())
    || s.harnessMeta.description.trim() !== "";
}

/** Authored content only — run output never reaches disk. */
export function stripRuntime(graph: HarnessGraph): HarnessGraph {
  return {
    nodes: graph.nodes.map((n) => {
      const data = { ...n.data } as Record<string, unknown>;
      for (const k of RUNTIME_NODE_KEYS) delete data[k];
      return { ...n, data: data as HarnessNode["data"] };
    }),
    edges: graph.edges.map((e) => {
      if (!e.data) return { ...e };
      const data = { ...e.data };
      for (const k of RUNTIME_EDGE_KEYS) delete data[k];
      return { ...e, data };
    }),
  };
}

const contentKey = (s: CanvasSnapshot) => JSON.stringify({
  name: s.harnessMeta.name, description: s.harnessMeta.description, graph: stripRuntime(s),
});

interface DocsState {
  items: HarnessMeta[];
  loaded: boolean;
  error: string;
  saveState: SaveState;
  /** The open harness has edits not yet on disk. */
  dirty: boolean;
  refresh: () => Promise<void>;
}

export const useStudioDocsStore = create<DocsState>((set) => ({
  items: [],
  loaded: false,
  error: "",
  saveState: "idle",
  dirty: false,
  refresh: async () => {
    try {
      const items = await api.harnesses.list();
      set({ items, loaded: true, error: "" });
    } catch {
      set({ loaded: true, error: "Couldn't reach the local engine, so saved harnesses can't be listed right now." });
    }
  },
}));

let lastSaved: string | null = null;
let epoch = 0;
let timer: ReturnType<typeof setTimeout> | null = null;
let inFlight: Promise<void> | null = null;
let again = false;

/** The canvas as it is now counts as saved (after opening something). */
export function markClean(): void {
  epoch += 1;
  if (timer) clearTimeout(timer);
  timer = null;
  lastSaved = contentKey(useCanvasStore.getState());
  useStudioDocsStore.setState({ dirty: false });
}

function needsSave(): boolean {
  const s = useCanvasStore.getState();
  if (contentKey(s) === lastSaved) return false;
  return Boolean(s.harnessMeta.id) || hasStudioDraft(s);
}

async function save(): Promise<void> {
  if (!needsSave()) return;
  const mine = epoch;
  const s = useCanvasStore.getState();
  const key = contentKey(s);
  const graph = stripRuntime(s);
  const { id, name, description } = s.harnessMeta;
  useStudioDocsStore.setState({ saveState: "saving" });
  try {
    if (id) {
      await api.harnesses.update(id, { name, description, graph_json: graph });
    } else {
      const res = await api.harnesses.create(name, description, graph);
      // Another harness was opened meanwhile: the record exists and is listed,
      // but must not be stamped onto what is open now.
      if (mine === epoch) useCanvasStore.getState().setHarnessMeta({ id: res.id });
    }
    if (mine === epoch) lastSaved = key;
    useStudioDocsStore.setState({ saveState: "saved", dirty: needsSave() });
    void useStudioDocsStore.getState().refresh();
  } catch {
    useStudioDocsStore.setState({ saveState: "error" });
  }
}

/** Save pending edits now (before opening something else, or on demand). */
export function flushAutosave(): Promise<void> {
  if (timer) clearTimeout(timer);
  timer = null;
  if (inFlight) {
    again = true;
    return inFlight;
  }
  inFlight = save().finally(() => {
    inFlight = null;
    if (again) {
      again = false;
      void flushAutosave();
    }
  });
  return inFlight;
}

/** Debounced autosave of canvas edits. Returns the unsubscribe. */
export function startAutosave(): () => void {
  const schedule = () => {
    // Run status/output churn is not an edit; re-check once the run ends.
    if (useCanvasStore.getState().isRunning || !needsSave()) return;
    if (!useStudioDocsStore.getState().dirty) useStudioDocsStore.setState({ dirty: true });
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void flushAutosave(), AUTOSAVE_MS);
  };
  const unsubscribe = useCanvasStore.subscribe(schedule);
  const onHide = () => { if (document.visibilityState === "hidden") void flushAutosave(); };
  document.addEventListener("visibilitychange", onHide);
  return () => {
    unsubscribe();
    document.removeEventListener("visibilitychange", onHide);
    if (timer) clearTimeout(timer);
    timer = null;
  };
}

function guardRun(): void {
  if (useCanvasStore.getState().isRunning) throw new Error("Stop the current run first.");
}

function loadIntoCanvas(graph: HarnessGraph, meta: { id: string | null; name: string; description: string }): void {
  const canvas = useCanvasStore.getState();
  canvas.loadGraph(graph.nodes, graph.edges);
  canvas.setHarnessMeta(meta);
  // Chat's "Use in chat" composes from this bundle; keep it about this harness.
  const bundle = composeBundleFromCanvas(null, { nodes: graph.nodes, edges: graph.edges, harnessMeta: meta });
  useHarnessSessionStore.getState().replaceBundle(bundle as unknown as HarnessBundle);
  markClean();
}

export async function openSavedHarness(id: string): Promise<void> {
  guardRun();
  await flushAutosave();
  const record = await api.harnesses.get(id);
  guardRun();
  const raw = record.graph_json ?? { nodes: [], edges: [] };
  if (!Array.isArray(raw.nodes) || !Array.isArray(raw.edges)) throw new Error("This saved harness has no editable graph.");
  loadIntoCanvas(stripRuntime(raw), { id: record.id, name: record.name, description: record.description ?? "" });
  useShellStore.getState().setSection("studio");
  useShellStore.getState().setStudioView("editor");
}

export async function removeSavedHarness(id: string): Promise<void> {
  const isOpen = useCanvasStore.getState().harnessMeta.id === id;
  if (isOpen) {
    guardRun();
    // Don't let a pending autosave recreate what is being deleted.
    if (timer) clearTimeout(timer);
    timer = null;
  }
  const res = await api.harnesses.delete(id);
  if (!res.ok && res.status !== 404) {
    if (isOpen) void flushAutosave();
    throw new Error("The local engine refused to delete this harness.");
  }
  useStudioDocsStore.setState((s) => ({ items: s.items.filter((i) => i.id !== id) }));
  if (isOpen && useCanvasStore.getState().harnessMeta.id === id) {
    loadIntoCanvas({ nodes: [], edges: [] }, { id: null, name: "Untitled harness", description: "" });
    useShellStore.getState().setStudioView("overview");
  }
}
