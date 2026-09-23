"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TitleBar } from "./TitleBar";
import { ActivityRail } from "./ActivityRail";
import { StatusBar } from "./StatusBar";
import { CommandPalette } from "./CommandPalette";
import { KeymapSheet } from "./KeymapSheet";
import { HarnessLibrarySheet } from "./HarnessLibrarySheet";
import { useShellStore, LEFT_MIN, LEFT_MAX, RIGHT_MIN, RIGHT_MAX, type RailSection } from "./shellStore";
import { isEditingTarget, matchesChord, useIsMac } from "./keys";
import { shellNavCommands, type Command } from "./commands";
import { useModeStore } from "@/store/modeStore";
import { useProviderStore } from "@/components/providers/providerStore";

/**
 * Split handle. 5px hit area over a 1px visual rule — the standard trick, but
 * the rule only takes on signal while actually dragging, so a pointer sweeping
 * across the window does not light the frame up like a christmas tree.
 * Arrow keys move it 16px at a time, because a mouse-only resize is a resize
 * some people cannot perform.
 */
function Resizer({
  side,
  value,
  min,
  max,
  onChange,
}: {
  side: "left" | "right";
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
}) {
  const dragging = useRef(false);
  const el = useRef<HTMLDivElement>(null);

  const onPointerDown = (e: React.PointerEvent) => {
    dragging.current = true;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    el.current?.setAttribute("data-dragging", "true");
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragging.current) return;
    const rect = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect();
    onChange(side === "left" ? e.clientX - rect.left : rect.right - e.clientX);
  };
  const end = () => {
    dragging.current = false;
    el.current?.removeAttribute("data-dragging");
  };

  return (
    <div
      ref={el}
      role="separator"
      aria-orientation="vertical"
      aria-valuenow={value}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={end}
      onPointerCancel={end}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 48 : 16;
        if (e.key === "ArrowLeft") {
          e.preventDefault();
          onChange(value + (side === "left" ? -step : step));
        } else if (e.key === "ArrowRight") {
          e.preventDefault();
          onChange(value + (side === "left" ? step : -step));
        }
      }}
      className="group relative z-10 w-[5px] flex-none cursor-col-resize bg-transparent"
      style={{ marginInline: "-2px" }}
    >
      <span className="pointer-events-none absolute inset-y-0 left-[2px] w-px bg-line transition-colors group-hover:bg-ink-faint group-data-[dragging]:bg-signal" />
    </div>
  );
}

interface Props {
  commands: Command[];
  harnessName: string;
  onHarnessNameChange: (v: string) => void;
  mode: string;
  running: boolean;
  nodeCount: number;
  edgeCount: number;
  selectedId: string | null;
  backendOk: boolean;
  immersive?: boolean;
  toolbar: React.ReactNode;
  left: React.ReactNode;
  stage: React.ReactNode;
  right: React.ReactNode;
}

export function AppShell({
  commands,
  harnessName,
  onHarnessNameChange,
  mode,
  running,
  nodeCount,
  edgeCount,
  selectedId,
  backendOk,
  immersive = false,
  toolbar,
  left,
  stage,
  right,
}: Props) {
  const mac = useIsMac();
  const shell = useShellStore();
  const shellMode = useModeStore((s) => s.mode);
  const hydrateProviders = useProviderStore((s) => s.hydrate);

  useEffect(() => {
    shell.hydrate();
    void hydrateProviders();
    // Hydration runs once, deliberately.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* Narrow-window policy. A stated preference is never overwritten — the
     panels are *suppressed* while the window is too small to hold them and
     come back at full width, so resizing a window never silently loses the
     layout someone chose. */
  const [narrow, setNarrow] = useState<{ right: boolean; left: boolean }>({
    right: false,
    left: false,
  });
  useEffect(() => {
    const measure = () =>
      setNarrow({ right: window.innerWidth < 1020, left: window.innerWidth < 640 });
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  const {
    hydrated,
    leftOpen: leftPref,
    rightOpen: rightPref,
    leftWidth,
    rightWidth,
    paletteOpen,
    keymapOpen,
    setLeftWidth,
    setRightWidth,
    toggleLeft,
    toggleRight,
    setPaletteOpen,
    setKeymapOpen,
    setSection,
    dismissOverlays,
  } = shell;

  const leftOpen = leftPref && !narrow.left;
  const rightOpen = rightPref && !narrow.right;

  const allCommands = useMemo(() => [...shellNavCommands(), ...commands], [commands]);

  const commandsRef = useRef(allCommands);
  commandsRef.current = allCommands;

  const onKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const editing = isEditingTarget(e.target);

      // Overlay-owning chords first: the palette must open from anywhere,
      // including from inside the harness-name field.
      if (matchesChord(e, "Mod+K", mac)) {
        e.preventDefault();
        setPaletteOpen(!useShellStore.getState().paletteOpen);
        return;
      }
      if (e.key === "Escape") {
        dismissOverlays();
        return;
      }
      if (useShellStore.getState().paletteOpen || useShellStore.getState().keymapOpen || useShellStore.getState().libraryOpen) return;

      if (!editing && e.key === "?") {
        e.preventDefault();
        setKeymapOpen(true);
        return;
      }
      if (matchesChord(e, "Mod+B", mac)) {
        e.preventDefault();
        toggleLeft();
        return;
      }
      if (matchesChord(e, "Mod+Alt+B", mac)) {
        e.preventDefault();
        toggleRight();
        return;
      }
      // Alt+1..6 — the destinations, same order as the rail, everywhere.
      const NAV_CHORDS: [string, RailSection][] = [
        ["Alt+1", "chats"],
        ["Alt+2", "studio"],
        ["Alt+3", "automations"],
        ["Alt+4", "git"],
        ["Alt+5", "providers"],
      ];
      for (const [chord, target] of NAV_CHORDS) {
        if (matchesChord(e, chord, mac)) {
          e.preventDefault();
          setSection(target);
          return;
        }
      }
      for (const c of commandsRef.current) {
        if (c.chord && !c.disabled && matchesChord(e, c.chord, mac)) {
          e.preventDefault();
          c.run();
          return;
        }
      }
    },
    [
      mac,
      setPaletteOpen,
      setKeymapOpen,
      toggleLeft,
      toggleRight,
      setSection,

      dismissOverlays,
    ]
  );

  useEffect(() => {
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onKeyDown]);

  return (
    <div
      className="oh-shell flex h-screen flex-col overflow-hidden"
      data-shell-mode={shellMode}
    >
      <TitleBar
        harnessName={harnessName}
        onHarnessNameChange={onHarnessNameChange}
        mode={shellMode === "agent" ? "Agent" : "Studio"}
        running={running}
        nodeCount={nodeCount}
        editingHarness={shellMode === "studio" && shell.studioView === "editor"}
        onOpenPalette={() => setPaletteOpen(true)}
      />

      {toolbar}

      <div className="flex min-h-0 flex-1">
        <ActivityRail>{leftOpen && !immersive ? left : null}</ActivityRail>
        <Resizer side="left" value={leftWidth} min={LEFT_MIN} max={LEFT_MAX} onChange={setLeftWidth} />

        <main className="relative min-w-0 flex-1 bg-sub-000">{stage}</main>

        {rightOpen && !immersive && right && (
          <>
            <Resizer
              side="right"
              value={rightWidth}
              min={RIGHT_MIN}
              max={RIGHT_MAX}
              onChange={setRightWidth}
            />
            <div
              className="min-h-0 flex-none border-l border-line"
              style={{ width: hydrated ? rightWidth : undefined, minWidth: RIGHT_MIN }}
            >
              {right}
            </div>
          </>
        )}
      </div>

      {shellMode === "studio" && shell.studioView === "editor" && (
        <StatusBar
          mode={`Studio · exec ${mode}`}
          running={running}
          nodeCount={nodeCount}
          edgeCount={edgeCount}
          selectedId={selectedId}
          backendOk={backendOk}
        />
      )}

      <CommandPalette
        open={paletteOpen}
        commands={allCommands}
        onClose={() => setPaletteOpen(false)}
      />
      <KeymapSheet open={keymapOpen} onClose={() => setKeymapOpen(false)} />
      <HarnessLibrarySheet />
    </div>
  );
}
