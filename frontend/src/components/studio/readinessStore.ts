"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { create } from "zustand";
import { mockBundle, validateBundle, type MockStep } from "@/lib/bundlesApi";
import { bundleErrorsToProblems, structuralFindings, summarizeReadiness, type BundleCheck, type Readiness } from "@/lib/readiness";
import { composeStudioBundle } from "@/lib/studio";
import { useCanvasStore } from "@/store/canvasStore";
import { useHarnessSessionStore } from "@/store/harnessSessionStore";

/**
 * The single readiness check for the Studio editor, and the single place a
 * simulation plan is requested. The header pill reads `useReadinessCheck()`;
 * Run and the palette read `summary`; the Problems panel reads both.
 */

export const readinessConfig = { debounceMs: 400 };

// Selection, dragging and run telemetry do not change what is being checked.
function without(record: object, keys: string[]) {
  return Object.fromEntries(Object.entries(record).filter(([key]) => !keys.includes(key)));
}

/** A stamp of everything the engine would validate. Equal stamps, equal verdict. */
export function currentDraftKey(): string {
  const { nodes, edges, harnessMeta } = useCanvasStore.getState();
  const activeBundle = useHarnessSessionStore.getState().activeBundle;
  return JSON.stringify({
    nodes: nodes.map((node) => ({
      ...without(node, ["selected", "dragging", "measured", "width", "height"]),
      data: without(node.data, ["status", "output", "error", "tokens", "latencyMs"]),
    })),
    edges: edges.map((edge) => without(edge, ["selected"])),
    harnessMeta,
    activeBundle,
  });
}

export interface PlanState {
  status: "idle" | "working" | "ok" | "error";
  message: string;
  errors: string[];
  steps: MockStep[];
  /** The draft the plan was made for; a changed draft makes it stale. */
  forKey: string;
}

const NO_NODES: Readiness = { state: "empty", label: "Nothing to check yet", problems: [], blocking: false };

interface ReadinessStore {
  summary: Readiness;
  /** Which panel is open under the header. */
  panel: null | "problems" | "plan";
  plan: PlanState;
  openPanel: (panel: "problems" | "plan") => void;
  closePanel: () => void;
  /** Ask the engine to simulate the harness: no provider is called. */
  runPlan: () => Promise<void>;
  /** Bumped to force the bundle check to run again (Check again, Engine offline retry). */
  recheckNonce: number;
  recheck: () => void;
}

let planTicket = 0;
const idlePlan: PlanState = { status: "idle", message: "", errors: [], steps: [], forKey: "" };

export const useReadinessStore = create<ReadinessStore>((set) => ({
  summary: NO_NODES,
  panel: null,
  plan: idlePlan,
  recheckNonce: 0,
  openPanel: (panel) => set({ panel }),
  closePanel: () => set({ panel: null }),
  recheck: () => set((s) => ({ recheckNonce: s.recheckNonce + 1 })),
  runPlan: async () => {
    if (useCanvasStore.getState().isRunning) return;
    const ticket = ++planTicket;
    const forKey = currentDraftKey();
    set({ panel: "plan", plan: { ...idlePlan, status: "working", message: "Planning simulation…", forKey } });
    const current = () => ticket === planTicket && forKey === currentDraftKey();
    // A newer request owns the panel; a changed draft makes this one stale.
    const stale = () => {
      if (ticket === planTicket) set({ plan: { ...idlePlan, forKey, status: "error", message: "The harness changed while planning. Plan again." } });
    };
    try {
      const result = await mockBundle(composeStudioBundle());
      if (!current()) return stale();
      set({
        plan: {
          forKey,
          status: result.ok ? "ok" : "error",
          message: result.ok ? `Simulation plan · ${result.steps.length} step${result.steps.length === 1 ? "" : "s"} · no provider called` : "Simulation rejected",
          errors: result.errors ?? [],
          steps: result.steps ?? [],
        },
      });
    } catch (error) {
      if (!current()) return stale();
      set({ plan: { ...idlePlan, forKey, status: "error", message: error instanceof Error ? error.message : "Simulation failed" } });
    }
  },
}));

/**
 * Mount once, in the editor header. Structure is derived synchronously; the
 * bundle is validated by the engine a moment after the last edit. Anything
 * that arrives for a draft that has since changed is dropped, so the pill can
 * never say "Ready to run" about a graph that is no longer the one on screen.
 */
export function useReadinessCheck(): Readiness {
  const nodes = useCanvasStore((s) => s.nodes);
  const edges = useCanvasStore((s) => s.edges);
  const harnessMeta = useCanvasStore((s) => s.harnessMeta);
  const activeBundle = useHarnessSessionStore((s) => s.activeBundle);
  const nonce = useReadinessStore((s) => s.recheckNonce);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const key = useMemo(() => currentDraftKey(), [nodes, edges, harnessMeta, activeBundle]);
  const [result, setResult] = useState<{ forKey: string; nonce: number; check: BundleCheck } | null>(null);
  const ticket = useRef(0);

  useEffect(() => () => { ticket.current++; }, []);

  useEffect(() => {
    if (nodes.length === 0) return;
    const mine = ++ticket.current;
    const stamp = key;
    const timer = setTimeout(async () => {
      const live = () => mine === ticket.current && stamp === currentDraftKey();
      try {
        const verdict = await validateBundle(composeStudioBundle());
        if (!live()) return;
        const errors = bundleErrorsToProblems(verdict.errors ?? [], useCanvasStore.getState().nodes);
        setResult({ forKey: stamp, nonce, check: verdict.ok ? { status: "ok", errors: [] } : { status: "errors", errors } });
      } catch {
        if (live()) setResult({ forKey: stamp, nonce, check: { status: "offline", errors: [] } });
      }
    }, readinessConfig.debounceMs);
    return () => clearTimeout(timer);
    // `nodes.length` only gates the check; the stamp carries the content.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, nonce, nodes.length > 0]);

  const summary = useMemo(() => {
    const bundle: BundleCheck = result && result.forKey === key && result.nonce === nonce ? result.check : { status: "checking", errors: [] };
    return summarizeReadiness({ nodeCount: nodes.length, structure: structuralFindings(nodes, edges), bundle });
  }, [result, key, nonce, nodes, edges]);

  useEffect(() => { useReadinessStore.setState({ summary }); }, [summary]);
  useEffect(() => () => { useReadinessStore.setState({ summary: NO_NODES, panel: null }); }, []);
  return summary;
}
