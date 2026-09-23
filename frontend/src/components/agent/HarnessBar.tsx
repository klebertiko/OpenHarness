"use client";

import { HarnessSwitch } from "@/components/agent/HarnessSwitch";
import { useShellStore } from "@/components/shell/shellStore";
import { useCanvasStore } from "@/store/canvasStore";
import { useHarnessSessionStore } from "@/store/harnessSessionStore";
import { bundleGraphToCanvas } from "@/lib/bundleGraph";

export type HarnessBarProps = {
  onOpenStudio?: () => void;
  onOpenProviders?: () => void;
};

/** The harness picker in the composer toolbar, wired to Studio and Providers.
    `section` (shellStore) is the single source of truth for what's on screen;
    modeStore only mirrors it (see page.tsx), so navigation must go through
    setSection — setting modeStore directly is a no-op nothing renders from. */
export function HarnessBar({ onOpenStudio, onOpenProviders }: HarnessBarProps) {
  const setSection = useShellStore((s) => s.setSection);

  /* Switching to Studio alone leaves the canvas showing whatever was last on
     it — the session's active bundle and the canvas are two separate stores
     with nothing connecting them. "Edit in Studio" only means "edit" if it
     loads that harness's authored graph and metadata before handing off. */
  const openStudioWithActiveGraph = () => {
    const bundle = useHarnessSessionStore.getState().activeBundle;
    if (bundle?.graph) {
      const { nodes, edges } = bundleGraphToCanvas(bundle.graph);
      useCanvasStore.getState().loadGraph(nodes, edges);
      useCanvasStore.getState().setHarnessMeta({
        id: bundle.manifest.id,
        name: bundle.manifest.name ?? bundle.manifest.id,
        description: bundle.manifest.description ?? "",
      });
    }
    setSection("studio");
    useShellStore.getState().setStudioView("editor");
  };

  return (
    <div className="flex min-w-0 items-center" data-testid="harness-bar">
      <HarnessSwitch
        embedded
        onOpenStudio={onOpenStudio ?? openStudioWithActiveGraph}
        onOpenProviders={onOpenProviders ?? (() => setSection("providers"))}
      />
    </div>
  );
}
