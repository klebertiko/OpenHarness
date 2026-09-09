"use client";
import { useEffect, useState } from "react";
import { Mark } from "./Mark";
import { useShellStore } from "./shellStore";
import { chordCaps, useIsMac } from "./keys";

/**
 * Window chrome.
 *
 * The app ships with native decorations OFF (see docs/adr/0001), so this bar
 * *is* the window's title bar — not a picture of one. It owns the drag region,
 * the window buttons on Windows/Linux, and a 68px inset on macOS where the
 * system draws its own traffic lights over our surface.
 *
 * The centre cell is the one idea worth defending here: it is a live readout
 * (mode · backend · nodes · last latency) that is *also* the command entry.
 * A desktop tool's title bar is prime real estate; giving it to an empty search
 * box wastes it, and giving it to a centred document title wastes it twice.
 */

interface Props {
  harnessName: string;
  onHarnessNameChange: (v: string) => void;
  mode: string;
  running: boolean;
  nodeCount: number;
  onOpenPalette: () => void;
}

function useTauriWindow() {
  const [w, setW] = useState<Record<string, () => void> | null>(null);
  useEffect(() => {
    const g = window as unknown as { __TAURI__?: { window?: { getCurrentWindow?: () => unknown } } };
    if (!g.__TAURI__?.window?.getCurrentWindow) return;
    setW(g.__TAURI__.window.getCurrentWindow() as Record<string, () => void>);
  }, []);
  return w;
}

function WindowButton({
  label,
  onClick,
  danger,
  children,
}: {
  label: string;
  onClick: () => void;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className={[
        "grid h-titlebar w-[44px] place-items-center text-ink-mute transition-colors",
        danger ? "hover:bg-fault hover:text-[color:var(--sub-000)]" : "hover:bg-sub-300 hover:text-ink",
      ].join(" ")}
    >
      {children}
    </button>
  );
}

export function TitleBar({
  harnessName,
  onHarnessNameChange,
  mode,
  running,
  nodeCount,
  onOpenPalette,
}: Props) {
  const mac = useIsMac();
  const win = useTauriWindow();
  const { paletteOpen } = useShellStore();
  const caps = chordCaps("Mod+K", mac);

  return (
    <header
      data-tauri-drag-region
      className="relative z-30 flex h-titlebar flex-none items-stretch border-b border-line bg-sub-100 text-ink-dim"
    >
      {/* macOS draws traffic lights over this inset; on Windows/Linux the mark
          sits flush at the window edge like every other native app. */}
      {mac && <div className="w-[68px] flex-none" aria-hidden />}

      {/* ── Identity cell ───────────────────────────────────────────────── */}
      <div
        data-tauri-drag-region
        className="flex min-w-0 flex-none items-center gap-2 border-r border-line px-3"
      >
        <Mark />
        <span className="t-label select-none text-ink-mute">OPENHARNESS</span>
        <span className="text-ink-faint" aria-hidden>
          /
        </span>
        <input
          value={harnessName}
          onChange={(e) => onHarnessNameChange(e.target.value)}
          spellCheck={false}
          aria-label="Harness name"
          className="t-title w-[168px] min-w-0 rounded-control bg-transparent px-1 py-[1px] text-ink outline-none transition-colors hover:bg-sub-200 focus:bg-sub-200"
        />
      </div>

      {/* ── Readout / command entry ─────────────────────────────────────── */}
      <div data-tauri-drag-region className="flex min-w-0 flex-1 items-center justify-center px-3">
        <button
          type="button"
          onClick={onOpenPalette}
          aria-haspopup="dialog"
          aria-expanded={paletteOpen}
          className="oh-focus-inner group flex h-[22px] w-full max-w-[520px] items-stretch overflow-hidden rounded-control border border-line-soft bg-sub-200 transition-colors hover:border-line"
        >
          <span className="flex items-center gap-1.5 border-r border-line-soft px-2">
            <span
              className="h-[5px] w-[5px] flex-none rounded-[1px]"
              style={{ background: running ? "var(--signal)" : "var(--ink-faint)" }}
            />
            <span className="t-meta uppercase text-ink-dim">{running ? "running" : "idle"}</span>
          </span>
          <span className="t-meta flex min-w-0 flex-1 items-center gap-3 overflow-hidden whitespace-nowrap px-2.5 text-ink-mute">
            <span className="flex-none">
              mode <span className="text-ink-dim">{mode}</span>
            </span>
            <span className="flex-none">
              nodes <span className="text-ink-dim">{String(nodeCount).padStart(2, "0")}</span>
            </span>
            <span className="hidden flex-none lg:inline">
              backend <span className="text-ink-dim">127.0.0.1:8000</span>
            </span>
          </span>
          <span className="flex items-center gap-[3px] border-l border-line-soft px-2 opacity-70 transition-opacity group-hover:opacity-100">
            {caps.map((c) => (
              <kbd key={c} className="oh-kbd">
                {c}
              </kbd>
            ))}
          </span>
        </button>
      </div>

      {/* ── Window controls ─────────────────────────────────────────────── */}
      {!mac && (
        <div className="flex flex-none items-stretch border-l border-line">
          <WindowButton label="Minimise" onClick={() => win?.minimize?.()}>
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
              <rect x="0" y="4.5" width="10" height="1" fill="currentColor" />
            </svg>
          </WindowButton>
          <WindowButton label="Maximise" onClick={() => win?.toggleMaximize?.()}>
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden>
              <rect x="0.5" y="0.5" width="9" height="9" stroke="currentColor" />
            </svg>
          </WindowButton>
          <WindowButton label="Close" danger onClick={() => win?.close?.()}>
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
              <path d="M0 0 L10 10 M10 0 L0 10" stroke="currentColor" strokeWidth="1" />
            </svg>
          </WindowButton>
        </div>
      )}
    </header>
  );
}
