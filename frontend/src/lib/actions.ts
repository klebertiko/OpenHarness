"use client";
import { useCallback, useState } from "react";
import { useCanvasStore } from "@/store/canvasStore";
import { useActiveRunStore } from "@/store/activeRunStore";
import { api } from "@/lib/api";

/**
 * The harness verbs, in one place.
 *
 * Lifted out of the toolbar by the shell workstream so the command palette and
 * the toolbar invoke literally the same functions. The palette claims to be
 * the complete index of what this app can do; that claim only stays true if
 * there is no second, button-only copy of the logic.
 */
export function useHarnessActions() {
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");

  const save = useCallback(async () => {
    const { nodes, edges, harnessMeta, setHarnessMeta } = useCanvasStore.getState();
    setSaving(true);
    try {
      const graph = { nodes, edges };
      if (harnessMeta.id) {
        await api.harnesses.update(harnessMeta.id, {
          graph_json: graph,
          name: harnessMeta.name,
        });
      } else {
        const res = await api.harnesses.create(
          harnessMeta.name,
          harnessMeta.description,
          graph
        );
        setHarnessMeta({ id: res.id });
      }
      setSaveMsg("saved");
    } catch {
      setSaveMsg("save failed");
    } finally {
      setSaving(false);
      setTimeout(() => setSaveMsg(""), 2400);
    }
  }, []);

  const exportJson = useCallback(() => {
    const { nodes, edges, harnessMeta } = useCanvasStore.getState();
    const blob = new Blob([JSON.stringify({ nodes, edges }, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${harnessMeta.name.replace(/\s+/g, "_")}.harness.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  const importJson = useCallback(() => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          const parsed = JSON.parse(ev.target?.result as string);
          useCanvasStore.getState().loadGraph(parsed.nodes ?? [], parsed.edges ?? []);
        } catch {
          setSaveMsg("bad file");
          setTimeout(() => setSaveMsg(""), 2400);
        }
      };
      reader.readAsText(file);
    };
    input.click();
  }, []);

  const stop = useCallback(() => {
    void useActiveRunStore.getState().requestStop().then((sent) => {
      if (!sent) useCanvasStore.getState().setRunning(false);
    });
  }, []);

  const run = useCallback(() => {
    const s = useCanvasStore.getState();
    if (s.isRunning || s.nodes.length === 0) return;
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
        else if (event === "harness_done" || event === "run_stopped") {
          useActiveRunStore.getState().setRunId(null);
        }
      },
      () => {
        useActiveRunStore.getState().setRunId(null);
        useCanvasStore.getState().setRunning(false);
      }
    );
  }, []);

  return { run, stop, save, exportJson, importJson, saving, saveMsg };
}
