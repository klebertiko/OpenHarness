"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { CornerDownLeft } from "lucide-react";
import { matchCommands, type Command, type Match } from "./commands";
import { chordCaps, useIsMac } from "./keys";

/**
 * The command palette.
 *
 * Two decisions worth stating. First, it is anchored to the top of the window
 * and sized to the title bar's readout, so it reads as that control expanding
 * downward rather than as a modal that teleported in from nowhere. Second, it
 * is square-cornered and hairline-bordered like every other surface: a floating
 * rounded card with a blurred backdrop is the house style of every generated
 * palette on earth, and it does not belong on an instrument.
 */

function Highlight({ text, hits }: { text: string; hits: number[] }) {
  if (!hits.length) return <>{text}</>;
  const set = new Set(hits);
  return (
    <>
      {text.split("").map((ch, i) =>
        set.has(i) ? (
          <span key={i} className="text-signal">
            {ch}
          </span>
        ) : (
          <span key={i}>{ch}</span>
        )
      )}
    </>
  );
}

function Row({
  match,
  active,
  mac,
  onRun,
  onHover,
}: {
  match: Match;
  active: boolean;
  mac: boolean;
  onRun: () => void;
  onHover: () => void;
}) {
  const { command, hits } = match;
  const Icon = command.icon;
  const ref = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: "nearest" });
  }, [active]);

  return (
    <button
      ref={ref}
      type="button"
      role="option"
      aria-selected={active}
      disabled={command.disabled}
      onMouseMove={onHover}
      onClick={onRun}
      className={[
        "flex h-[30px] w-full items-center gap-2.5 px-2.5 text-left transition-none",
        command.disabled ? "opacity-35" : "",
        active ? "bg-sub-300" : "",
      ].join(" ")}
    >
      <span
        className="h-[14px] w-[2px] flex-none rounded-[1px]"
        style={{ background: command.role ?? (active ? "var(--signal)" : "transparent") }}
        aria-hidden
      />
      <Icon
        size={14}
        strokeWidth={1.6}
        absoluteStrokeWidth
        className={active ? "flex-none text-ink" : "flex-none text-ink-mute"}
      />
      <span className="t-title min-w-0 flex-1 truncate text-ink">
        <Highlight text={command.label} hits={hits} />
      </span>
      {command.meta && <span className="t-meta flex-none text-ink-faint">{command.meta}</span>}
      {command.chord && (
        <span className="flex flex-none items-center gap-[3px]">
          {chordCaps(command.chord, mac).map((c) => (
            <kbd key={c} className="oh-kbd">
              {c}
            </kbd>
          ))}
        </span>
      )}
    </button>
  );
}

export function CommandPalette({
  open,
  commands,
  onClose,
}: {
  open: boolean;
  commands: Command[];
  onClose: () => void;
}) {
  const mac = useIsMac();
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const matches = useMemo(() => matchCommands(commands, query), [commands, query]);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setCursor(0);
    // Focus after paint so the caret lands even when opened from a keydown.
    const id = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [open]);

  useEffect(() => setCursor(0), [query]);

  if (!open) return null;

  const run = (i: number) => {
    const m = matches[i];
    if (!m || m.command.disabled) return;
    onClose();
    m.command.run();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown" || (e.key === "n" && e.ctrlKey)) {
      e.preventDefault();
      setCursor((c) => Math.min(matches.length - 1, c + 1));
    } else if (e.key === "ArrowUp" || (e.key === "p" && e.ctrlKey)) {
      e.preventDefault();
      setCursor((c) => Math.max(0, c - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      run(cursor);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };

  // Group headings are emitted inline so the list stays one flat, arrow-
  // navigable sequence — grouping is a label, not a nested structure.
  let lastGroup = "";

  return (
    <div
      className="fixed inset-0 z-50 flex justify-center bg-[rgb(0_0_0/0.42)] pt-[calc(var(--h-titlebar)+10px)]"
      onMouseDown={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="oh-float flex h-fit max-h-[min(64vh,520px)] w-[min(560px,calc(100vw-40px))] flex-col overflow-hidden"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Query row */}
        <div className="flex h-[34px] flex-none items-center gap-2.5 border-b border-line px-2.5">
          <span className="h-[15px] w-[2px] flex-none rounded-[1px] bg-signal" aria-hidden />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            spellCheck={false}
            role="combobox"
            aria-expanded
            aria-controls="oh-cmd-list"
            placeholder="Run a command, add a node, open a harness"
            /* No focus ring here: the palette is a focus context of its own,
               and a signal rectangle around the only field in a modal states
               something the user already knows. The tick to its left is the
               marker. */
            className="t-title h-full flex-1 bg-transparent text-ink outline-none focus-visible:outline-none placeholder:text-ink-faint"
          />
          <span className="t-meta flex-none tabular-nums text-ink-faint">
            {matches.length.toString().padStart(2, "0")}
          </span>
        </div>

        {/* Results */}
        <div id="oh-cmd-list" role="listbox" className="min-h-0 flex-1 overflow-y-auto py-1">
          {matches.length === 0 && (
            <p className="t-body px-3 py-6 text-center text-ink-mute">
              Nothing matches <span className="t-meta text-ink-dim">{query}</span>
            </p>
          )}
          {matches.map((m, i) => {
            const showGroup = m.command.group !== lastGroup;
            lastGroup = m.command.group;
            return (
              <div key={m.command.id}>
                {showGroup && (
                  <div className="flex items-center gap-2 px-2.5 pb-1 pt-2.5">
                    <span className="t-label text-ink-faint">{m.command.group}</span>
                    <span className="h-px flex-1 bg-line-soft" aria-hidden />
                  </div>
                )}
                <Row
                  match={m}
                  active={i === cursor}
                  mac={mac}
                  onRun={() => run(i)}
                  onHover={() => setCursor(i)}
                />
              </div>
            );
          })}
        </div>

        {/* Legend */}
        <div className="flex h-[24px] flex-none items-center gap-3 border-t border-line bg-sub-200 px-2.5">
          <span className="t-meta flex items-center gap-1 text-ink-faint">
            <kbd className="oh-kbd">↑</kbd>
            <kbd className="oh-kbd">↓</kbd>
            move
          </span>
          <span className="t-meta flex items-center gap-1 text-ink-faint">
            <kbd className="oh-kbd">
              <CornerDownLeft size={9} strokeWidth={2} />
            </kbd>
            run
          </span>
          <span className="t-meta flex items-center gap-1 text-ink-faint">
            <kbd className="oh-kbd">Esc</kbd>
            dismiss
          </span>
          <span className="flex-1" />
          <span className="t-meta text-ink-faint">every action lives here</span>
        </div>
      </div>
    </div>
  );
}
