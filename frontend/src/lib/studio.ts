import { useShellStore } from "@/components/shell/shellStore";
import { useCanvasStore } from "@/store/canvasStore";
import { useHarnessSessionStore, type HarnessBundle } from "@/store/harnessSessionStore";
import { bundleGraphToCanvas } from "./bundleGraph";
import { composeBundleFromCanvas, fetchDefault, isOHarnessBundle } from "./bundlesApi";
import type { HARNESS_PRESETS } from "./templates";

export function openStudioBundle(bundle: HarnessBundle): void {
  if (useCanvasStore.getState().isRunning) throw new Error("Stop the current run before opening another harness.");
  if (!bundle.manifest?.id || !Array.isArray(bundle.graph?.nodes) || !Array.isArray(bundle.graph?.edges)) {
    throw new Error("This harness has no editable graph.");
  }
  // Convert before replacing the draft so an invalid graph cannot erase it.
  const copy = structuredClone(bundle);
  const { nodes, edges } = bundleGraphToCanvas(copy.graph!);
  useHarnessSessionStore.getState().replaceBundle(copy);
  const canvas = useCanvasStore.getState();
  canvas.loadGraph(nodes, edges);
  // A bundle identifier is not a saved harness record in the local database.
  canvas.setHarnessMeta({ id: null, name: copy.manifest.name || copy.manifest.id, description: copy.manifest.description || "" });
  useShellStore.getState().setSection("studio");
  useShellStore.getState().setStudioView("editor");
}

export async function openBundledHarness(signal?: AbortSignal): Promise<void> {
  const bundle = await fetchDefault();
  if (!signal?.aborted) openStudioBundle(bundle as unknown as HarnessBundle);
}

export function openStudioPreset(preset: (typeof HARNESS_PRESETS)[number]): void {
  const bundle = composeBundleFromCanvas(null, {
    nodes: [], edges: [], harnessMeta: { name: preset.name, description: preset.description },
  });
  bundle.manifest.id = "openharness.studio.sample." + preset.id;
  bundle.graph = structuredClone(preset.graph);
  openStudioBundle(bundle as unknown as HarnessBundle);
  useCanvasStore.getState().setExecutionMode("mock");
}

export function newStudioHarness(): void {
  const bundle = composeBundleFromCanvas(null, {
    nodes: [], edges: [], harnessMeta: { name: "Untitled harness", description: "" },
  });
  openStudioBundle(bundle as unknown as HarnessBundle);
  useCanvasStore.getState().setExecutionMode("mock");
}

export function useStudioInChat(): void {
  const session = useHarnessSessionStore.getState();
  const { nodes, edges, harnessMeta } = useCanvasStore.getState();
  const base = isOHarnessBundle(session.activeBundle) ? session.activeBundle : null;
  const bundle = composeBundleFromCanvas(base, { nodes, edges, harnessMeta });
  session.replaceBundle(bundle as unknown as HarnessBundle);
  session.setEnabled(true);
  useShellStore.getState().setSection("chats");
}
