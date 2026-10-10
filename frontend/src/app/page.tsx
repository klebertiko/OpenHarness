"use client";
import { useEffect, useMemo } from "react";
import { ReactFlowProvider } from "@xyflow/react";
import {
  Play,
  Square,
  Save,
  SaveAll,
  Download,
  Upload,
  FilePlus,
  FlaskConical,
  ListChecks,
  MessageSquare,
  Undo2,
  Redo2,
  Trash2,
  PanelLeft,
  PanelRight,
  Keyboard,
  Shuffle,
  LayoutTemplate,
  Sparkles,
} from "lucide-react";

import { StudioOverview } from "@/components/studio/StudioOverview";
import { StudioHeader } from "@/components/studio/StudioHeader";
import { useReadinessStore } from "@/components/studio/readinessStore";
import { useStudioHeaderStore } from "@/components/studio/studioHeaderStore";
import { exportOhm, pickAndImport, saveNow } from "@/lib/studioFileActions";
import { newStudioHarness, openStudioPreset, useStudioInChat } from "@/lib/studio";
import { hasStudioDraft, startAutosave } from "@/lib/studioDocuments";
import { AppShell } from "@/components/shell/AppShell";
import { Panel } from "@/components/shell/Panel";
import { useShellStore } from "@/components/shell/shellStore";
import type { Command } from "@/components/shell/commands";

import { NodePalette } from "@/components/sidebar/NodePalette";
import { StudioSidePanel } from "@/components/copilot/StudioSidePanel";
import { useCopilotStore } from "@/store/copilotStore";
import { HarnessCanvas } from "@/components/canvas/HarnessCanvas";
import { AgentStage } from "@/components/agent/AgentStage";
import { ThreadsSidebar } from "@/components/agent/ThreadsSidebar";
import { PROVIDERS_PANEL_TITLE } from "@/components/providers/copy";
import { ProvidersList } from "@/components/providers/ProvidersList";
import { Dossier } from "@/components/providers/Dossier";
import { useProviderStore } from "@/components/providers/providerStore";

import { useCanvasStore } from "@/store/canvasStore";
import { useModeStore } from "@/store/modeStore";
import { useActiveRunStore } from "@/store/activeRunStore";
import { useHarnessActions } from "@/lib/actions";
import { NODE_TEMPLATES, HARNESS_PRESETS } from "@/lib/templates";
import { ROLE_ICON, ROLE_VAR } from "@/lib/roles";
import type { ExecutionMode, HarnessNode, NodeType } from "@/lib/types";

const MODE_ORDER: ExecutionMode[] = ["mock", "live", "local"];

export default function Home() {
  const {
    nodes,
    selectedNodeId,
    executionMode,
    isRunning,
    setSelectedNode,
    setExecutionMode,
    setRunning,
    addNode,
    deleteSelected,
    undo,
    redo,
  } = useCanvasStore();

  const setMode = useModeStore((s) => s.setMode);
  const actions = useHarnessActions();
  const { section, studioView, toggleLeft, toggleRight, setKeymapOpen, setSection, setStudioView } =
    useShellStore();
  const connectionCount = useProviderStore((s) => s.connections.length);
  const isStudio = section === "studio";
  const copilotOpen = useCopilotStore((s) => s.open);
  const openCopilot = useCopilotStore((s) => s.openCopilot);

  // `section` is the single source of truth for what's on screen; keep the
  // legacy modeStore in step so TitleBar and canvas hooks stay coherent.
  useEffect(() => {
    setMode(isStudio ? "studio" : "agent");
  }, [isStudio, setMode]);

  // Every edited harness is saved to the local engine as the person works.
  useEffect(() => startAutosave(), []);

  /* Deep link: /?preset=critic-gate opens a named preset on load. Useful for
     docs links and for handing someone a reproducible starting graph. */
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("preset");
    if (!id) return;
    const p = HARNESS_PRESETS.find((x) => x.id === id);
    if (!p) return;
    openStudioPreset(p);
  }, []);

  const loadPreset = (p: (typeof HARNESS_PRESETS)[number]) => {
    openStudioPreset(p);
  };

  const commands = useMemo<Command[]>(() => {
    const insert: Command[] = NODE_TEMPLATES.map((t) => ({
      id: `insert:${t.type}`,
      label: `Add ${t.label}`,
      group: "Insert node",
      icon: ROLE_ICON[t.type as NodeType],
      meta: t.type,
      role: ROLE_VAR[t.type as NodeType],
      keywords: t.description,
      run: () => {
        const node: HarnessNode = {
          id: `${t.type}-${Date.now()}`,
          type: t.type,
          position: { x: 160 + nodes.length * 28, y: 120 + (nodes.length % 5) * 46 },
          data: { ...t.defaultData } as HarnessNode["data"],
        };
        if (!hasStudioDraft(useCanvasStore.getState())) newStudioHarness();
        setSection("studio");
        setStudioView("editor");
        addNode(node);
        setSelectedNode(node.id);
      },
    }));

    const presets: Command[] = HARNESS_PRESETS.map((p) => ({
      id: `preset:${p.id}`,
      label: p.name,
      group: "Open preset",
      disabled: isRunning,
      icon: LayoutTemplate,
      meta: p.id,
      keywords: p.description,
      run: () => loadPreset(p),
    }));

    // Run/File/Edit/insert/preset commands all act on the canvas graph — on
    // any other destination they're not just idle, they're a wall of actions
    // with nothing to act on, which is what made the palette feel like it
    // dumped "everything" regardless of what screen you were looking at.
    const studioOnly: Command[] = !isStudio
      ? []
      : [
          {
            id: "run",
            label: "Run harness",
            group: "Run",
            icon: Play,
            chord: "Mod+Enter",
            meta: executionMode,
            disabled: isRunning || nodes.length === 0,
            run: actions.run,
          },
          {
            id: "stop",
            label: "Stop run",
            group: "Run",
            icon: Square,
            disabled: !isRunning,
            run: () => {
              void useActiveRunStore.getState().requestStop().then((sent) => {
                if (!sent) setRunning(false);
              });
            },
          },
          {
            id: "mode",
            label: "Cycle execution mode",
            group: "Run",
            icon: Shuffle,
            chord: "Mod+Shift+M",
            meta: executionMode,
            run: () =>
              setExecutionMode(MODE_ORDER[(MODE_ORDER.indexOf(executionMode) + 1) % MODE_ORDER.length]),
          },
          {
            id: "save",
            label: "Save harness",
            group: "File",
            icon: Save,
            chord: "Mod+S",
            disabled: studioView !== "editor" || isRunning,
            run: () => void saveNow(),
          },
          {
            id: "save-as",
            label: "Save harness as…",
            group: "File",
            icon: SaveAll,
            disabled: studioView !== "editor" || isRunning,
            run: () => useStudioHeaderStore.getState().setPending("saveas"),
          },
          {
            id: "new",
            label: "New harness",
            group: "File",
            icon: FilePlus,
            disabled: isRunning,
            run: newStudioHarness,
          },
          {
            id: "import",
            label: "Import harness (.ohm)…",
            group: "File",
            icon: Upload,
            keywords: "open file json bundle",
            disabled: isRunning,
            run: () => void pickAndImport(),
          },
          {
            id: "export",
            label: "Export harness (.ohm)",
            group: "File",
            icon: Download,
            chord: "Mod+Shift+E",
            keywords: "save file bundle download",
            disabled: studioView !== "editor",
            run: () => void exportOhm(),
          },
          {
            id: "plan",
            label: "Plan simulation",
            group: "Run",
            icon: FlaskConical,
            keywords: "mock dry run steps no provider",
            disabled: studioView !== "editor" || isRunning || nodes.length === 0,
            run: () => void useReadinessStore.getState().runPlan(),
          },
          {
            id: "run-in-chat",
            label: "Run in chat",
            group: "Run",
            icon: MessageSquare,
            keywords: "use harness conversation",
            disabled: isRunning || nodes.length === 0,
            run: useStudioInChat,
          },
          {
            id: "problems",
            label: "Show problems",
            group: "Run",
            icon: ListChecks,
            keywords: "readiness check validate errors",
            disabled: studioView !== "editor" || nodes.length === 0,
            run: () => useReadinessStore.getState().openPanel("problems"),
          },
          {
            id: "copilot",
            label: "Ask Nilo",
            group: "Studio",
            icon: Sparkles,
            chord: "Mod+I",
            keywords: "assistant ai build graph",
            disabled: studioView !== "editor",
            run: openCopilot,
          },
          { id: "undo", label: "Undo", group: "Edit", icon: Undo2, chord: "Mod+Z", run: undo },
          { id: "redo", label: "Redo", group: "Edit", icon: Redo2, chord: "Mod+Shift+Z", run: redo },
          {
            id: "delete",
            label: "Delete selected node",
            group: "Edit",
            icon: Trash2,
            meta: selectedNodeId ?? undefined,
            disabled: !selectedNodeId,
            run: deleteSelected,
          },
          ...presets,
          ...insert,
          {
            id: "toggle-right",
            label: "Toggle inspector",
            group: "View",
            icon: PanelRight,
            chord: "Mod+Alt+B",
            run: toggleRight,
          },
        ];

    return [
      ...studioOnly,
      {
        id: "toggle-left",
        label: "Toggle left panel",
        group: "View",
        icon: PanelLeft,
        chord: "Mod+B",
        run: toggleLeft,
      },
      {
        id: "keymap",
        label: "Show keyboard map",
        group: "View",
        icon: Keyboard,
        run: () => setKeymapOpen(true),
      },
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes.length, executionMode, isRunning, selectedNodeId, actions, isStudio, studioView, openCopilot]);

  const providersLeft = (
    <Panel title={PROVIDERS_PANEL_TITLE} meta={`${connectionCount}`} className="h-full">
      <ProvidersList />
    </Panel>
  );

  // The contextual left panel. Destinations that own the whole stage don't
  // get one.
  const left =
    section === "providers"
      ? providersLeft
      : section === "studio"
        ? (studioView === "editor" ? <NodePalette /> : null)
        : section === "chats"
          ? <ThreadsSidebar />
          : null;

  const studioStage = studioView === "overview" ? <StudioOverview /> : (
    <div className="flex h-full min-h-0 flex-col">
      <StudioHeader />
      <div className="relative min-h-0 flex-1">
        <HarnessCanvas onNodeClick={(id) => setSelectedNode(id)} />
        {nodes.length === 0 && <div className="pointer-events-none absolute inset-4 flex items-center justify-center"><p className="max-w-[300px] rounded-control border border-line bg-sub-100 p-4 text-[13px] leading-6 text-ink-mute">This harness is empty. Add a block from the left, ask Nilo to draft one, or bring in a file from the File menu.</p></div>}
      </div>
    </div>
  );

  const stage =
    section === "providers" ? (
      <Dossier />
    ) : isStudio ? (
      studioStage
    ) : (
      <AgentStage />
    );

  return (
    <ReactFlowProvider>
      <AppShell
        commands={commands}
        running={isRunning}
        immersive={isStudio && studioView === "overview"}
        left={left}
        stage={stage}
        right={isStudio && studioView === "editor" && (selectedNodeId || copilotOpen) ? <StudioSidePanel /> : null}
      />
    </ReactFlowProvider>
  );
}
