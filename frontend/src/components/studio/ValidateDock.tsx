"use client";
import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Download, FlaskConical, Upload } from "lucide-react";
import { composeBundleFromCanvas, downloadOHarness, isOHarnessBundle, mockBundle, validateBundle, type MockStep } from "@/lib/bundlesApi";
import { openStudioBundle } from "@/lib/studio";
import { useCanvasStore } from "@/store/canvasStore";
import { useHarnessSessionStore, type HarnessBundle } from "@/store/harnessSessionStore";
type DockStatus = "idle" | "working" | "ok" | "error";
// Selection, dragging and run telemetry do not change what was validated.
function without(record: object, keys: string[]) {
  return Object.fromEntries(Object.entries(record).filter(([key]) => !keys.includes(key)));
}
function draftKey() {
  const { nodes, edges, harnessMeta } = useCanvasStore.getState();
  const activeBundle = useHarnessSessionStore.getState().activeBundle;
  return JSON.stringify({
    nodes: nodes.map(node => ({ ...without(node, ["selected", "dragging", "measured"]), data: without(node.data, ["status", "output", "error", "tokens", "latencyMs"]) })),
    edges: edges.map(edge => without(edge, ["selected"])), harnessMeta, activeBundle,
  });
}
export function ValidateDock() {
  const fileRef = useRef<HTMLInputElement>(null);
  const requestId = useRef(0);
  useEffect(() => () => { requestId.current++; }, []);
  const [status, setStatus] = useState<DockStatus>("idle");
  const [message, setMessage] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [steps, setSteps] = useState<MockStep[]>([]);
  const [resultFor, setResultFor] = useState("");
  const nodes = useCanvasStore(s => s.nodes);
  const edges = useCanvasStore(s => s.edges);
  const harnessMeta = useCanvasStore(s => s.harnessMeta);
  const running = useCanvasStore(s => s.isRunning);
  const activeBundle = useHarnessSessionStore(s => s.activeBundle);
  const key = draftKey();
  const fresh = resultFor === key;
  const busy = fresh && status === "working";
  const compose = () => composeBundleFromCanvas(isOHarnessBundle(activeBundle) ? activeBundle : null, { nodes, edges, harnessMeta });
  function begin(label: string) {
    const ticket = ++requestId.current, stamp = draftKey();
    setResultFor(stamp); setStatus("working"); setMessage(label); setErrors([]); setSteps([]);
    return () => ticket === requestId.current && stamp === draftKey();
  }
  function fail(error: unknown) { setStatus("error"); setMessage(error instanceof Error ? error.message : "Operation failed"); }
  async function inspect(kind: "validate" | "mock") {
    if (useCanvasStore.getState().isRunning) return;
    const current = begin(kind === "validate" ? "Validating…" : "Planning simulation…");
    try {
      const bundle = compose();
      if (kind === "validate") {
        const result = await validateBundle(bundle); if (!current()) return;
        setStatus(result.ok ? "ok" : "error"); setMessage(result.ok ? "Bundle valid" : "Validation failed"); setErrors(result.errors ?? []);
      } else {
        const result = await mockBundle(bundle); if (!current()) return;
        setStatus(result.ok ? "ok" : "error");
        setMessage(result.ok ? "Simulation plan · " + result.steps.length + " step(s) · no provider called" : "Simulation rejected");
        setErrors(result.errors ?? []); setSteps(result.steps ?? []);
      }
    } catch (error) { if (current()) fail(error); }
  }
  function onExport() {
    begin("Exporting…");
    try { downloadOHarness(compose()); setStatus("ok"); setMessage("Downloaded .ohm"); }
    catch (error) { fail(error); }
  }
  async function onImportFile(file: File) {
    if (useCanvasStore.getState().isRunning) return;
    const current = begin("Importing " + file.name + "…");
    try {
      const parsed: unknown = JSON.parse(await file.text());
      const result = await validateBundle(parsed);
      if (!current() || useCanvasStore.getState().isRunning) return;
      if (!result.ok) { setStatus("error"); setMessage("Import failed validation"); setErrors(result.errors ?? []); return; }
      if (!isOHarnessBundle(parsed)) { setStatus("error"); setMessage("Not a recognizable .ohm bundle"); return; }
      openStudioBundle(parsed as unknown as HarnessBundle);
      setResultFor(draftKey()); setStatus("ok"); setMessage("Imported · " + parsed.manifest.id);
    } catch (error) { if (current()) fail(error); }
  }
  return <div className="flex flex-none flex-col border-t border-line bg-sub-100">
    <div className="flex min-h-[36px] flex-wrap items-center gap-1 border-b border-line-soft px-2 py-1">
      <span className="t-label mr-1 text-ink-faint">BUNDLE</span>
      <DockAction icon={CheckCircle2} label="Validate" onClick={() => void inspect("validate")} disabled={busy || running} />
      <DockAction icon={FlaskConical} label="Plan simulation" onClick={() => void inspect("mock")} disabled={busy || running} />
      <span className="mx-1 h-[14px] w-px bg-line-soft" aria-hidden />
      <DockAction icon={Download} label="Export .ohm" onClick={onExport} disabled={busy} />
      <DockAction icon={Upload} label="Import .ohm" onClick={() => fileRef.current?.click()} disabled={busy || running} />
      <input ref={fileRef} type="file" accept=".ohm,.oharness,application/json" className="hidden" disabled={running}
        onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void onImportFile(file); }} />
      <span className="flex-1" />
      {fresh && message && <span role="status" className={"t-meta min-w-0 truncate " + (status === "error" ? "text-fault" : status === "ok" ? "text-signal" : "text-ink-mute")} title={message}>{message}</span>}
    </div>
    {fresh && (errors.length > 0 || steps.length > 0) && <div className="max-h-[120px] overflow-y-auto px-2.5 py-1.5">
      {errors.length > 0 && <ul className="space-y-0.5">{errors.map((error, i) => <li key={i} className="t-meta text-fault">{error}</li>)}</ul>}
      {steps.length > 0 && <ol className="space-y-0.5">{steps.map((step, i) => <li key={step.nodeId + i} className="t-meta text-ink-dim">{i + 1}. {step.role} ({step.nodeId}) — {step.status}{step.note ? " · " + step.note : ""}</li>)}</ol>}
    </div>}
  </div>;
}
function DockAction({ icon: Icon, label, onClick, disabled }: { icon: typeof CheckCircle2; label: string; onClick: () => void; disabled?: boolean }) {
  return <button type="button" title={label} aria-label={label} disabled={disabled} onClick={onClick}
    className="flex h-[24px] items-center gap-1 whitespace-nowrap rounded-control px-1.5 text-ink-mute transition-colors hover:bg-sub-300 hover:text-ink disabled:opacity-40">
    <Icon size={12} strokeWidth={1.6} absoluteStrokeWidth /><span className="t-meta">{label}</span>
  </button>;
}
