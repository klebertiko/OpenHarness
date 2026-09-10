"use client";

import { X } from "lucide-react";

import { AutomationsPanel } from "@/components/automations/AutomationsPanel";
import { CoworkPanel } from "@/components/cowork/CoworkPanel";
import { GitPanel } from "@/components/git/GitPanel";
import {
  useShellStore,
  type ShellOverlay,
} from "@/components/shell/shellStore";

const TITLES: Record<Exclude<ShellOverlay, null>, string> = {
  cowork: "Cowork",
  automations: "Automations",
  git: "Pull requests",
};

function OverlayBody({ overlay }: { overlay: Exclude<ShellOverlay, null> }) {
  switch (overlay) {
    case "cowork":
      return <CoworkPanel />;
    case "automations":
      return <AutomationsPanel />;
    case "git":
      return <GitPanel />;
  }
}

/**
 * Lightweight float hosting Agent panels formerly on Chat tabs.
 * Opened via palette; Escape / backdrop / close clears `shellStore.overlay`.
 */
export function ShellOverlayHost() {
  const overlay = useShellStore((s) => s.overlay);
  const setOverlay = useShellStore((s) => s.setOverlay);

  if (!overlay) return null;

  const title = TITLES[overlay];
  const onClose = () => setOverlay(null);

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-[rgb(0_0_0/0.42)] px-6 py-10"
      onMouseDown={onClose}
      role="presentation"
      data-shell-overlay={overlay}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="oh-float flex h-[min(80vh,640px)] w-[min(720px,100%)] flex-col overflow-hidden"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex h-[30px] flex-none items-center gap-2.5 border-b border-line px-3">
          <span className="h-[13px] w-[2px] rounded-[1px] bg-signal" aria-hidden />
          <h2 className="t-title text-ink">{title}</h2>
          <span className="flex-1" />
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-[22px] w-[22px] items-center justify-center text-ink-mute transition-colors hover:text-ink"
          >
            <X size={14} strokeWidth={1.6} absoluteStrokeWidth />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-hidden">{OverlayBody({ overlay })}</div>
      </div>
    </div>
  );
}
