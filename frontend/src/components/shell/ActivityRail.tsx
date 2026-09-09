"use client";
import { Bot, Boxes, History, Plug, FolderTree, Keyboard, Settings2 } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useModeStore, type ShellMode } from "@/store/modeStore";
import { useShellStore, type RailSection } from "./shellStore";
import { chordCaps, useIsMac } from "./keys";

/**
 * The rail is the app's table of contents. Modes first (Agent | Studio), then
 * sections — fixed order, fixed position so muscle memory holds. Alt+1..2 switch
 * mode; Alt+3..5 jump to a section.
 *
 * The active item is marked by a signal rule on the *outer* edge, not by a
 * filled pill: a filled pill at 46px turns the rail into a column of buttons
 * competing with the canvas. A 2px rule states position and then shuts up.
 */

const MODES: { id: ShellMode; label: string; icon: LucideIcon; chord: string }[] = [
  { id: "agent", label: "Agent", icon: Bot, chord: "Alt+1" },
  { id: "studio", label: "Studio", icon: Boxes, chord: "Alt+2" },
];

const SECTIONS: { id: RailSection; label: string; icon: LucideIcon; chord: string }[] = [
  { id: "runs", label: "Runs", icon: History, chord: "Alt+3" },
  { id: "providers", label: "Providers", icon: Plug, chord: "Alt+4" },
  { id: "files", label: "Harnesses", icon: FolderTree, chord: "Alt+5" },
];

function RailButton({
  icon: Icon,
  label,
  hint,
  active,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  hint?: string;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={hint ? `${label} · ${hint}` : label}
      aria-label={label}
      aria-pressed={active}
      className={[
        "relative grid h-[42px] w-full place-items-center transition-colors",
        active ? "text-ink" : "text-ink-mute hover:text-ink-dim",
      ].join(" ")}
    >
      {active && (
        <span className="absolute left-0 top-[9px] h-[24px] w-[2px] rounded-r-[1px] bg-signal" aria-hidden />
      )}
      <Icon size={16} strokeWidth={1.6} absoluteStrokeWidth />
    </button>
  );
}

export function ActivityRail() {
  const mac = useIsMac();
  const shellMode = useModeStore((s) => s.mode);
  const setMode = useModeStore((s) => s.setMode);
  const { section, setSection, setKeymapOpen } = useShellStore();

  return (
    <nav
      aria-label="Sections"
      className="flex w-rail flex-none flex-col items-stretch border-r border-line bg-sub-100"
    >
      {MODES.map((m) => (
        <RailButton
          key={m.id}
          icon={m.icon}
          label={m.label}
          hint={chordCaps(m.chord, mac).join(" ")}
          active={shellMode === m.id}
          onClick={() => {
            setMode(m.id);
            if (m.id === "studio") setSection("build");
          }}
        />
      ))}

      <div className="mx-2 my-1 h-px bg-line-soft" aria-hidden />

      {SECTIONS.map((s) => (
        <RailButton
          key={s.id}
          icon={s.icon}
          label={s.label}
          hint={chordCaps(s.chord, mac).join(" ")}
          active={section === s.id}
          onClick={() => setSection(s.id)}
        />
      ))}

      <div className="flex-1" />

      <RailButton
        icon={Keyboard}
        label="Keyboard map"
        hint="?"
        onClick={() => setKeymapOpen(true)}
      />
      <RailButton icon={Settings2} label="Settings" onClick={() => undefined} />
    </nav>
  );
}
