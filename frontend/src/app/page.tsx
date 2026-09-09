"use client";
import { useEffect, useMemo, useState } from "react";
import { ReactFlowProvider } from "@xyflow/react";
import {
  Play,
  Square,
  Save,
  Download,
  Upload,
  Undo2,
  Redo2,
  Trash2,
  PanelLeft,
  PanelRight,
  Keyboard,
  Shuffle,
  LayoutTemplate,
} from "lucide-react";

import { AppShell } from "@/components/shell/AppShell";
import { Panel } from "@/components/shell/Panel";
import { Mark } from "@/components/shell/Mark";
import { useShellStore } from "@/components/shell/shellStore";
import { chordCaps, useIsMac } from "@/components/shell/keys";
import type { Command } from "@/components/shell/commands";

import { Toolbar } from "@/components/toolbar/Toolbar";
import { NodePalette } from "@/components/sidebar/NodePalette";
import { PropertiesPanel } from "@/components/sidebar/PropertiesPanel";
import { HarnessCanvas } from "@/components/canvas/HarnessCanvas";

import { useCanvasStore } from "@/store/canvasStore";
import { useHarnessActions } from "@/lib/actions";
import { NODE_TEMPLATES, HARNESS_PRESETS } from "@/lib/templates";
import { ROLE_ICON, ROLE_VAR } from "@/lib/roles";
import type { ExecutionMode, HarnessNode, HarnessEdge, NodeType } from "@/lib/types";

const MODE_ORDER: ExecutionMode[] = ["mock", "live", "local"];

/**
 * Empty stage.
 *
 * A blank canvas is the screen most people meet first, so it gets the same
 * care as a populated one: what this surface is for, and the two ways in —
 * one for the hand, one for the keyboard. No illustration, no marketing.
 */
function EmptyStage({ onPreset }: { onPreset: () => void }) {
  const mac = useIsMac();
  const setPaletteOpen = useShellStore((s) => s.setPaletteOpen);

  return (
    <div className="pointer-events-none absolute inset-0 grid place-items-center">
      <div className="pointer-events-auto w-[300px]">
        <div className="mb-3 flex items-center gap-2">
          <Mark size={16} />
          <span className="t-label text-ink-faint">EMPTY BENCH</span>
          <span className="h-px flex-1 bg-line-soft" aria-hidden />
        </div>
        <p className="t-body mb-3.5 text-ink-mute">
          A harness is a graph of nodes your prompt travels through. Drop one in, or start from a
          shape that already works.
        </p>
        <div className="flex flex-col gap-px overflow-hidden rounded-control border border-line">
          <button
            onClick={onPreset}
            className="flex items-center gap-2.5 bg-sub-100 px-2.5 py-2 text-left transition-colors hover:bg-sub-200"
          >
            <LayoutTemplate size={14} strokeWidth={1.6} absoluteStrokeWidth className="text-signal" />
            <span className="t-title flex-1 text-ink">Load the Critic Gate preset</span>
          </button>
          <button
            onClick={() => setPaletteOpen(true)}
            className="flex items-center gap-2.5 bg-sub-100 px-2.5 py-2 text-left transition-colors hover:bg-sub-200"
          >
            <Keyboard size={14} strokeWidth={1.6} absoluteStrokeWidth className="text-ink-mute" />
            <span className="t-title flex-1 text-ink-dim">Open the command palette</span>
            <span className="flex items-center gap-[3px]">
              {chordCaps("Mod+K", mac).map((c) => (
                <kbd key={c} className="oh-kbd">
                  {c}
                </kbd>
              ))}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}

/** Placeholder panels for the rail sections other workstreams own. */
function StubPanel({ title, note }: { title: string; note: string }) {
  return (
    <Panel title={title} className="h-full">
      <p className="t-body p-3 text-ink-mute">{note}</p>
    </Panel>
  );
}

export default function Home() {
  const {
    nodes,
    edges,
    selectedNodeId,
    executionMode,
    isRunning,
    harnessMeta,
    setSelectedNode,
    setExecutionMode,
    setHarnessMeta,
    setRunning,
    loadGraph,
    addNode,
    deleteSelected,
    undo,
    redo,
  } = useCanvasStore();

  const actions = useHarnessActions();
  const { section, toggleLeft, toggleRight, setKeymapOpen } = useShellStore();
  const [backendOk, setBackendOk] = useState(false);

  /* Deep link: /?preset=critic-gate opens a named preset on load. Useful for
     docs links and for handing someone a reproducible starting graph. */
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("preset");
    if (!id) return;
    const p = HARNESS_PRESETS.find((x) => x.id === id);
    if (!p) return;
    loadGraph(p.graph.nodes as HarnessNode[], p.graph.edges as HarnessEdge[]);
    setHarnessMeta({ id: null, name: p.name, description: p.description });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let alive = true;
    const ping = () =>
      fetch("/api/health", { cache: "no-store" })
        .then((r) => r.json())
        .then((d) => alive && setBackendOk(Boolean(d.ok)))
        .catch(() => alive && setBackendOk(false));
    ping();
    const t = setInterval(ping, 15000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  const loadPreset = (p: (typeof HARNESS_PRESETS)[number]) => {
    loadGraph(p.graph.nodes as HarnessNode[], p.graph.edges as HarnessEdge[]);
    setHarnessMeta({ id: null, name: p.name, description: p.description });
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
        addNode(node);
        setSelectedNode(node.id);
      },
    }));

    const presets: Command[] = HARNESS_PRESETS.map((p) => ({
      id: `preset:${p.id}`,
      label: p.name,
      group: "Open preset",
      icon: LayoutTemplate,
      meta: p.id,
      keywords: p.description,
      run: () => loadPreset(p),
    }));

    return [
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
        run: () => setRunning(false),
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
        run: actions.save,
      },
      {
        id: "export",
        label: "Export graph as JSON",
        group: "File",
        icon: Download,
        chord: "Mod+Shift+E",
        run: actions.exportJson,
      },
      { id: "import", label: "Import graph from JSON", group: "File", icon: Upload, run: actions.importJson },
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
        id: "toggle-left",
        label: "Toggle nodes panel",
        group: "View",
        icon: PanelLeft,
        chord: "Mod+B",
        run: toggleLeft,
      },
      {
        id: "toggle-right",
        label: "Toggle inspector",
        group: "View",
        icon: PanelRight,
        chord: "Mod+Alt+B",
        run: toggleRight,
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
  }, [nodes.length, executionMode, isRunning, selectedNodeId, actions]);

  const left =
    section === "build" ? (
      <NodePalette />
    ) : section === "runs" ? (
      <StubPanel title="Runs" note="Execution history lands here once the run panel ships." />
    ) : section === "providers" ? (
      <StubPanel
        title="Providers"
        note="Anthropic, OpenAI, Cursor, OpenRouter and Ollama connections are wired in a later pass."
      />
    ) : (
      <StubPanel title="Harnesses" note="Saved harnesses from the local backend appear here." />
    );

  return (
    <ReactFlowProvider>
      <AppShell
        commands={commands}
        harnessName={harnessMeta.name}
        onHarnessNameChange={(name) => setHarnessMeta({ name })}
        mode={executionMode}
        running={isRunning}
        nodeCount={nodes.length}
        edgeCount={edges.length}
        selectedId={selectedNodeId}
        backendOk={backendOk}
        toolbar={
          <Toolbar
            onRun={actions.run}
            onSave={actions.save}
            onExport={actions.exportJson}
            onImport={actions.importJson}
            saveMsg={actions.saveMsg}
          />
        }
        left={left}
        stage={
          <>
            <HarnessCanvas onNodeClick={(id) => setSelectedNode(id)} />
            {nodes.length === 0 && <EmptyStage onPreset={() => loadPreset(HARNESS_PRESETS[1])} />}
          </>
        }
        right={<PropertiesPanel />}
      />
    </ReactFlowProvider>
  );
}
