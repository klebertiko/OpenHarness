"use client";
import { useEffect } from "react";
import { chordCaps, useIsMac } from "./keys";

/**
 * The keymap sheet (`?`). Every chord the shell owns, in the order a person
 * meets them, with the platform's real modifier glyphs — not a generic "Ctrl"
 * on a Mac. Nothing here is exclusive: each row also exists in the palette.
 */

const GROUPS: { title: string; rows: [string, string][] }[] = [
  {
    title: "Command",
    rows: [
      ["Mod+K", "Command palette"],
      ["?", "This sheet"],
      ["Escape", "Dismiss overlay"],
    ],
  },
  {
    title: "Run",
    rows: [
      ["Mod+Enter", "Run harness"],
      ["Mod+S", "Save harness"],
      ["Mod+Shift+M", "Cycle execution mode"],
    ],
  },
  {
    title: "Layout",
    rows: [
      ["Mod+B", "Toggle left panel"],
      ["Mod+Alt+B", "Toggle inspector (Studio)"],
      ["Alt+1", "Agent mode"],
      ["Alt+2", "Studio mode · canvas"],
      ["Alt+3", "Canvas (Studio)"],
      ["Alt+4", "Providers"],
      ["Alt+5", "Harnesses"],
      ["Alt+6", "Threads (Agent)"],
    ],
  },
  {
    title: "Graph",
    rows: [
      ["Mod+Z", "Undo"],
      ["Mod+Shift+Z", "Redo"],
      ["Mod+Shift+E", "Export graph as JSON"],
    ],
  },
];

export function KeymapSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const mac = useIsMac();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[rgb(0_0_0/0.42)] px-6"
      onMouseDown={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard map"
        className="oh-float w-[min(560px,100%)] overflow-hidden"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex h-[30px] items-center gap-2.5 border-b border-line px-3">
          <span className="h-[13px] w-[2px] rounded-[1px] bg-signal" aria-hidden />
          <h2 className="t-title text-ink">Keyboard map</h2>
          <span className="flex-1" />
          <span className="t-meta text-ink-faint">{mac ? "macOS" : "windows / linux"}</span>
        </div>

        <div className="grid grid-cols-2 gap-x-6 gap-y-4 p-4">
          {GROUPS.map((g) => (
            <section key={g.title}>
              <div className="mb-1.5 flex items-center gap-2">
                <span className="t-label text-ink-faint">{g.title}</span>
                <span className="h-px flex-1 bg-line-soft" aria-hidden />
              </div>
              <dl className="space-y-[3px]">
                {g.rows.map(([chord, label]) => (
                  <div key={chord} className="flex items-center gap-2">
                    <dt className="flex flex-none items-center gap-[3px]">
                      {chordCaps(chord, mac).map((c) => (
                        <kbd key={c} className="oh-kbd">
                          {c}
                        </kbd>
                      ))}
                    </dt>
                    <dd className="t-body min-w-0 truncate text-ink-dim">{label}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>

        <div className="flex h-[24px] items-center border-t border-line bg-sub-200 px-3">
          <span className="t-meta text-ink-faint">
            all of these are reachable from the command palette
          </span>
        </div>
      </div>
    </div>
  );
}
