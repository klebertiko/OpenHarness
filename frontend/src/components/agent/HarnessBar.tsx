"use client";

import { Boxes, Plug } from "lucide-react";

import { HarnessSwitch } from "@/components/agent/HarnessSwitch";
import { useShellStore } from "@/components/shell/shellStore";
import { useModeStore } from "@/store/modeStore";

export type HarnessBarProps = {
  /** Provider chip label — placeholder until Task 6 probe lands. */
  providerLabel?: string;
  onOpenStudio?: () => void;
  onOpenProviders?: () => void;
};

/**
 * Chrome above the Agent composer: On/Off · bundle · provider chip · Open in Studio.
 */
export function HarnessBar({
  providerLabel = "…",
  onOpenStudio,
  onOpenProviders,
}: HarnessBarProps) {
  const setMode = useModeStore((s) => s.setMode);
  const setSection = useShellStore((s) => s.setSection);

  const openStudio = () => {
    if (onOpenStudio) {
      onOpenStudio();
      return;
    }
    setMode("studio");
  };

  const openProviders = () => {
    if (onOpenProviders) {
      onOpenProviders();
      return;
    }
    setSection("providers");
  };

  return (
    <div
      className="flex h-[36px] flex-none items-center gap-2 border-t border-line bg-sub-100/90 px-3"
      data-testid="harness-bar"
    >
      <HarnessSwitch embedded />

      <span className="mx-0.5 h-[14px] w-px flex-none bg-line-soft" aria-hidden />

      <button
        type="button"
        onClick={openProviders}
        title="Open Providers"
        className="inline-flex h-[24px] max-w-[120px] items-center gap-1.5 rounded-control border border-line bg-sub-200 px-2 text-[12px] font-[500] text-ink-dim transition hover:bg-sub-300 hover:text-ink"
      >
        <Plug size={12} strokeWidth={1.8} className="flex-none text-ink-faint" />
        <span className="min-w-0 truncate">{providerLabel}</span>
      </button>

      <span className="flex-1" />

      <button
        type="button"
        onClick={openStudio}
        title="Open in Studio (Alt+2)"
        className="inline-flex h-[24px] items-center gap-1.5 rounded-control border border-line bg-sub-200 px-2.5 text-[12px] font-[500] text-ink-dim transition hover:bg-sub-300 hover:text-ink"
      >
        <Boxes size={12} strokeWidth={1.8} className="flex-none text-ink-faint" />
        <span>Open in Studio</span>
      </button>
    </div>
  );
}
