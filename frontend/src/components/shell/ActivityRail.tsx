"use client";
import { Bot, Boxes, History, Plug, FolderTree, Keyboard, LayoutTemplate, MessagesSquare } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useModeStore, type ShellMode } from "@/store/modeStore";
import { useShellStore, type RailSection } from "./shellStore";
import { chordCaps, useIsMac } from "./keys";

/**
 * Modes first (Agent | Studio), then sections that belong to the active mode.
 * Agent never shows Build (canvas); Studio never pretends Chat/Cowork live here.
 */

const MODES: { id: ShellMode; label: string; icon: LucideIcon; chord: string }[] = [
  { id: "agent", label: "Agent", icon: Bot, chord: "Alt+1" },
  { id: "studio", label: "Studio", icon: Boxes, chord: "Alt+2" },
];

type SectionItem = {
  id: RailSection;
  label: string;
  icon: LucideIcon;
  chord: string;
  /** Shown but not activatable — honest placeholder. */
  disabled?: boolean;
};

const AGENT_SECTIONS: SectionItem[] = [
  { id: "threads", label: "Threads", icon: MessagesSquare, chord: "Alt+6" },
  { id: "files", label: "Harnesses", icon: FolderTree, chord: "Alt+5" },
  { id: "providers", label: "Providers", icon: Plug, chord: "Alt+4" },
  {
    id: "runs",
    label: "Runs",
    icon: History,
    chord: "Alt+3",
    disabled: true,
  },
];

const STUDIO_SECTIONS: SectionItem[] = [
  { id: "build", label: "Canvas", icon: LayoutTemplate, chord: "Alt+3" },
  { id: "files", label: "Harnesses", icon: FolderTree, chord: "Alt+5" },
  { id: "providers", label: "Providers", icon: Plug, chord: "Alt+4" },
  {
    id: "runs",
    label: "Runs",
    icon: History,
    chord: "",
    disabled: true,
  },
];

function RailButton({
  icon: Icon,
  label,
  hint,
  active,
  disabled,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  hint?: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  const title = disabled
    ? `${label} · Coming soon`
    : hint
      ? `${label} · ${hint}`
      : label;

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={label}
      aria-pressed={active}
      aria-disabled={disabled || undefined}
      className={[
        "relative grid h-[44px] w-full place-items-center transition-colors",
        disabled
          ? "cursor-not-allowed text-ink-faint opacity-45"
          : active
            ? "text-ink"
            : "text-ink-mute hover:bg-sub-200/60 hover:text-ink",
      ].join(" ")}
    >
      {active && !disabled && (
        <span
          className="absolute left-0 top-[10px] h-[24px] w-[2px] rounded-r-[1px] bg-signal"
          aria-hidden
        />
      )}
      <Icon size={17} strokeWidth={1.7} absoluteStrokeWidth />
    </button>
  );
}

export function ActivityRail() {
  const mac = useIsMac();
  const shellMode = useModeStore((s) => s.mode);
  const setMode = useModeStore((s) => s.setMode);
  const { section, setSection, setKeymapOpen, setRightOpen } = useShellStore();
  const sections = shellMode === "studio" ? STUDIO_SECTIONS : AGENT_SECTIONS;

  return (
    <nav
      aria-label="Modes and sections"
      className="flex w-rail flex-none flex-col items-stretch border-r border-line bg-sub-100/90 shadow-[inset_-1px_0_0_0_var(--line-soft)]"
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
            if (m.id === "studio") {
              setSection("build");
              setRightOpen(true);
            } else {
              setSection("threads");
              setRightOpen(false);
            }
          }}
        />
      ))}

      <div className="mx-2 my-1 h-px bg-line-soft" aria-hidden />

      {sections.map((s) => (
        <RailButton
          key={`${shellMode}-${s.id}`}
          icon={s.icon}
          label={s.label}
          hint={s.chord ? chordCaps(s.chord, mac).join(" ") : undefined}
          active={section === s.id && !s.disabled}
          disabled={s.disabled}
          onClick={() => {
            if (s.disabled) return;
            setSection(s.id);
          }}
        />
      ))}

      <div className="flex-1" />

      <RailButton
        icon={Keyboard}
        label="Keyboard map"
        hint="?"
        onClick={() => setKeymapOpen(true)}
      />
    </nav>
  );
}
