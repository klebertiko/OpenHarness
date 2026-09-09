"use client";

import { useCallback, useRef, useState } from "react";
import { CheckCircle2, Download, FlaskConical, Upload } from "lucide-react";

import {
  composeBundleFromCanvas,
  downloadOHarness,
  fetchDefault,
  isOHarnessBundle,
  mockBundle,
  validateBundle,
  type MockStep,
  type OHarnessBundle,
} from "@/lib/bundlesApi";
import type { HarnessEdge, HarnessNode } from "@/lib/types";
import { useCanvasStore } from "@/store/canvasStore";
import { useHarnessSessionStore, type HarnessBundle } from "@/store/harnessSessionStore";

type DockStatus = "idle" | "working" | "ok" | "error";

/**
 * Studio validate / mock / import / export strip.
 *
 * Lives under the canvas so Agent mode never mounts it. Validate and mock hit
 * the same `/bundles/*` routes Plan 01 exposed; export composes canvas graph
 * with content stubs from the active (or default) bundle.
 */
export function ValidateDock() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<DockStatus>("idle");
  const [message, setMessage] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [steps, setSteps] = useState<MockStep[]>([]);

  const replaceBundle = useHarnessSessionStore((s) => s.replaceBundle);
  const activeBundle = useHarnessSessionStore((s) => s.activeBundle);

  const resolveBase = useCallback(async (): Promise<OHarnessBundle> => {
    if (activeBundle && isOHarnessBundle(activeBundle)) {
      return activeBundle;
    }
    return fetchDefault();
  }, [activeBundle]);

  const composeActive = useCallback(async (): Promise<OHarnessBundle> => {
    const base = await resolveBase();
    const { nodes, edges, harnessMeta } = useCanvasStore.getState();
    return composeBundleFromCanvas(base, { nodes, edges, harnessMeta });
  }, [resolveBase]);

  const onValidate = async () => {
    setStatus("working");
    setMessage("Validating…");
    setErrors([]);
    setSteps([]);
    try {
      const bundle = await composeActive();
      const result = await validateBundle(bundle);
      if (result.ok) {
        setStatus("ok");
        setMessage("Bundle valid");
        setErrors([]);
      } else {
        setStatus("error");
        setMessage("Validation failed");
        setErrors(result.errors ?? []);
      }
    } catch (err) {
      setStatus("error");
      setMessage((err as Error).message || "Validate failed");
      setErrors([]);
    }
  };

  const onMock = async () => {
    setStatus("working");
    setMessage("Planning mock run…");
    setErrors([]);
    setSteps([]);
    try {
      const bundle = await composeActive();
      const result = await mockBundle(bundle);
      setSteps(result.steps ?? []);
      if (result.ok) {
        setStatus("ok");
        setMessage(`Mock planned · ${result.steps.length} step(s)`);
        setErrors([]);
      } else {
        setStatus("error");
        setMessage("Mock rejected");
        setErrors(result.errors ?? []);
      }
    } catch (err) {
      setStatus("error");
      setMessage((err as Error).message || "Mock failed");
      setErrors([]);
    }
  };

  const onExport = async () => {
    setStatus("working");
    setMessage("Exporting…");
    try {
      const bundle = await composeActive();
      downloadOHarness(bundle);
      setStatus("ok");
      setMessage("Downloaded .oharness");
    } catch (err) {
      setStatus("error");
      setMessage((err as Error).message || "Export failed");
    }
  };

  const onImportFile = async (file: File) => {
    setStatus("working");
    setMessage(`Importing ${file.name}…`);
    setErrors([]);
    setSteps([]);
    try {
      const text = await file.text();
      const parsed: unknown = JSON.parse(text);
      const result = await validateBundle(parsed);
      if (!result.ok) {
        setStatus("error");
        setMessage("Import failed validation");
        setErrors(result.errors ?? []);
        return;
      }
      if (!isOHarnessBundle(parsed)) {
        setStatus("error");
        setMessage("Not a recognizable .oharness bundle");
        return;
      }
      replaceBundle(parsed as unknown as HarnessBundle);
      const graph = parsed.graph;
      const nodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
      const edges = Array.isArray(graph?.edges) ? graph.edges : [];
      const canvasReady = nodes.every(
        (n) =>
          n &&
          typeof n === "object" &&
          "position" in (n as object) &&
          "type" in (n as object)
      );
      if (canvasReady) {
        useCanvasStore
          .getState()
          .loadGraph(nodes as HarnessNode[], edges as HarnessEdge[]);
      }
      useCanvasStore.getState().setHarnessMeta({
        id: parsed.manifest.id,
        name: parsed.manifest.name,
        description: parsed.manifest.description,
      });
      setStatus("ok");
      setMessage(`Imported · ${parsed.manifest.id}`);
    } catch (err) {
      setStatus("error");
      setMessage((err as Error).message || "Import failed");
    }
  };

  return (
    <div className="flex flex-none flex-col border-t border-line bg-sub-100">
      <div className="flex h-[32px] items-center gap-1 border-b border-line-soft px-2">
        <span className="t-label mr-1 text-ink-faint">BUNDLE</span>
        <DockAction
          icon={CheckCircle2}
          label="Validate"
          onClick={onValidate}
          disabled={status === "working"}
        />
        <DockAction
          icon={FlaskConical}
          label="Mock"
          onClick={onMock}
          disabled={status === "working"}
        />
        <span className="mx-1 h-[14px] w-px bg-line-soft" aria-hidden />
        <DockAction
          icon={Download}
          label="Export .oharness"
          onClick={onExport}
          disabled={status === "working"}
        />
        <DockAction
          icon={Upload}
          label="Import .oharness"
          onClick={() => fileRef.current?.click()}
          disabled={status === "working"}
        />
        <input
          ref={fileRef}
          type="file"
          accept=".oharness,application/json"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) void onImportFile(file);
          }}
        />
        <span className="flex-1" />
        {message && (
          <span
            className={`t-meta truncate ${
              status === "error"
                ? "text-fault"
                : status === "ok"
                  ? "text-signal"
                  : "text-ink-mute"
            }`}
            title={message}
          >
            {message}
          </span>
        )}
      </div>

      {(errors.length > 0 || steps.length > 0) && (
        <div className="max-h-[120px] overflow-y-auto px-2.5 py-1.5">
          {errors.length > 0 && (
            <ul className="space-y-0.5">
              {errors.map((err) => (
                <li key={err} className="t-meta text-fault">
                  {err}
                </li>
              ))}
            </ul>
          )}
          {steps.length > 0 && (
            <ol className="space-y-0.5">
              {steps.map((step, i) => (
                <li key={`${step.nodeId}-${i}`} className="t-meta text-ink-dim">
                  <span className="text-ink-faint">{i + 1}.</span> {step.role}{" "}
                  <span className="text-ink-faint">({step.nodeId})</span> — {step.status}
                  {step.note ? ` · ${step.note}` : ""}
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </div>
  );
}

function DockAction({
  icon: Icon,
  label,
  onClick,
  disabled,
}: {
  icon: typeof CheckCircle2;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="flex h-[24px] items-center gap-1 rounded-control px-1.5 text-ink-mute transition-colors hover:bg-sub-300 hover:text-ink disabled:opacity-40"
    >
      <Icon size={12} strokeWidth={1.6} absoluteStrokeWidth />
      <span className="t-meta">{label}</span>
    </button>
  );
}
