"use client";
import { useEffect } from "react";
import { HarnessLibrary } from "@/components/harnesses/HarnessLibrary";
import { useShellStore } from "./shellStore";
import { openStudioBundle } from "@/lib/studio";

/**
 * Studio's "Open .ohm" — a sheet over the canvas, not a destination. Picking
 * a harness bundle is a step inside building one, so it never leaves Studio;
 * closing it (Escape, backdrop, or picking a bundle) drops you right back
 * where you were on the canvas.
 */
export function HarnessLibrarySheet() {
  const open = useShellStore((s) => s.libraryOpen);
  const setOpen = useShellStore((s) => s.setLibraryOpen);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setOpen]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[rgb(0_0_0/0.42)] px-6"
      onMouseDown={() => setOpen(false)}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Harness library"
        className="oh-float h-[min(560px,80vh)] w-[min(480px,100%)] overflow-hidden"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <HarnessLibrary onPicked={(bundle) => {
          openStudioBundle(bundle);
          setOpen(false);
        }} />
      </div>
    </div>
  );
}
