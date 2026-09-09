"use client";
import { Boxes, History, Plug, FolderTree, Keyboard, Settings2 } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useShellStore, type RailSection } from "./shellStore";
import { chordCaps, useIsMac } from "./keys";

/**
 * The rail is the app's table of contents. Four sections, fixed order, fixed
 * position — the point is muscle memory, so nothing here ever reorders or
 * appears conditionally. Alt+1..4 jumps straight to one.
 *
 * The active section is marked by a signal rule on the *outer* edge, not by a
 * filled pill: a filled pill at 46px turns the rail into a column of buttons
 * competing with the canvas. A 2px rule states position and then shuts up.
 */

const SECTIONS: { id: RailSection; label: string; icon: LucideIcon; chord: string }[] = [
  { id: "build", label: "Build", icon: Boxes, chord: "Alt+1" },
  { id: "runs", label: "Runs", icon: History, chord: "Alt+2" },
  { id: "providers", label: "Providers", icon: Plug, chord: "Alt+3" },
  { id: "files", label: "Harnesses", icon: FolderTree, chord: "Alt+4" },
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
  const { section, setSection, setKeymapOpen } = useShellStore();

  return (
    <nav
      aria-label="Sections"
      className="flex w-rail flex-none flex-col items-stretch border-r border-line bg-sub-100"
    >
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
