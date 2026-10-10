"use client";
import { useCallback } from "react";
import { useCanvasStore } from "@/store/canvasStore";
import { useActiveRunStore } from "@/store/activeRunStore";
import { api } from "@/lib/api";
import type { HarnessEdge, HarnessNode } from "@/lib/types";
import { useShellStore } from "@/components/shell/shellStore";
import { sendControl } from "@/components/agent-run/runClient";
import { replaceStudioCanvas } from "@/lib/studioDocuments";
import { useReadinessStore } from "@/components/studio/readinessStore";

/**
 * Load graph JSON as a new harness. It is saved right away and never
 * overwrites the open one, whose pending edits are saved first. Returns
 * false (and changes nothing) for a run in progress or unreadable JSON.
 */
export function importGraphFile(text: string, fileName: string): boolean {
  if (useCanvasStore.getState().isRunning) return false;
  let parsed: { nodes?: unknown; edges?: unknown };
  try {
    parsed = JSON.parse(text);
  } catch {
    return false;
  }
  const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
  const rawNodes = Array.isArray(parsed?.nodes) ? parsed.nodes : [];
  const rawEdges = Array.isArray(parsed?.edges) ? parsed.edges : [];
  // Reject anything the canvas can't render instead of half-loading it.
  const nodesOk = rawNodes.every((n) => isObj(n) && typeof n.id === "string" && typeof n.type === "string");
  const edgesOk = rawEdges.every((e) => isObj(e) && typeof e.source === "string" && typeof e.target === "string");
  if (!nodesOk || !edgesOk) return false;
  const nodes = rawNodes.map((n: Record<string, unknown>) => ({
    ...n,
    position: isObj(n.position) ? n.position : { x: 0, y: 0 },
    data: isObj(n.data) ? n.data : {},
  })) as unknown as HarnessNode[];
  const edges = rawEdges as unknown as HarnessEdge[];
  replaceStudioCanvas(() => {
    useCanvasStore.getState().loadGraph(nodes, edges);
    useCanvasStore.getState().setHarnessMeta({ id: null, name: fileName.replace(/\.(harness\.)?json$/i, "") || "Imported harness", description: "" });
  }, { saveNow: true });
  useShellStore.getState().setSection("studio");
  useShellStore.getState().setStudioView("editor");
  return true;
}

/**
 * The harness verbs, in one place.
 *
 * Run, Stop and answering a paused human step. The command palette, the
 * keyboard and the editor header's Run control invoke literally the same
 * functions. File verbs (save, import, export) live in studioFileActions.
 */
export function useHarnessActions() {
  const stop = useCallback(() => {
    void useActiveRunStore.getState().requestStop().then((sent) => {
      if (!sent) useCanvasStore.getState().setRunning(false);
    });
  }, []);

  const run = useCallback(() => {
    const s = useCanvasStore.getState();
    if (s.isRunning || s.nodes.length === 0) return;
    // A harness the engine rejects would only fail late and obscurely. Say what
    // is wrong, where, instead of starting. Reviews and an unreachable engine
    // never block: those are worth a look, not a reason to refuse.
    const readiness = useReadinessStore.getState();
    if (readiness.summary.blocking) {
      readiness.openPanel("problems");
      return;
    }
    s.resetExecution();
    s.setRunning(true);
    api.execute(
      { graph_json: { nodes: s.nodes, edges: s.edges }, mode: s.executionMode },
      (event, data) => {
        const d = data as Record<string, unknown>;
        const store = useCanvasStore.getState();
        if (event === "run_start" && d.run_id) {
          useActiveRunStore.getState().setRunId(String(d.run_id));
        } else if (event === "node_start") store.setNodeStatus(d.node_id as string, "running");
        else if (event === "node_stream")
          store.appendNodeOutput(d.node_id as string, d.chunk as string);
        else if (event === "node_done")
          store.setNodeResult(
            d.node_id as string,
            d.output as string,
            d.tokens as number,
            d.latency_ms as number
          );
        else if (event === "node_error")
          store.setNodeError(d.node_id as string, d.error as string);
        else if (event === "hitl_pause") {
          // Engine parked at a HITL node awaiting a person. Mirror the same
          // "paused"/held state the plate already renders, and stash the
          // question/context so the node's approve/reject controls go live.
          store.setNodeStatus(d.node_id as string, "paused");
          store.setAwaitingHuman({
            nodeId: d.node_id as string,
            question: String(
              d.question ?? "Approve this step and continue the run?"
            ),
            context: String(d.context ?? ""),
          });
        } else if (event === "hitl_resolved") {
          store.setAwaitingHuman(null);
        } else if (event === "harness_done" || event === "run_stopped") {
          useActiveRunStore.getState().setRunId(null);
        }
      },
      () => {
        useActiveRunStore.getState().setRunId(null);
        useCanvasStore.getState().setRunning(false);
      }
    );
  }, []);

  /**
   * Answer the HITL node the Studio run is currently parked on. Reuses the
   * same `/execute/{run_id}/control` call the chat side's `resolveGate`
   * already makes — the engine does not care which surface asked.
   */
  const resolveHitl = useCallback((decision: "approve" | "reject", note: string) => {
    const { runId } = useActiveRunStore.getState();
    if (!runId) return;
    void sendControl(runId, { action: "resume", decision, note });
  }, []);

  return { run, stop, resolveHitl };
}
