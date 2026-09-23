"use client";

import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Workflow } from "lucide-react";

import { harnessSubtitle, splitHarnessName } from "@/components/harnesses/harnessLabel";
import { useHarnessLibraryStore } from "@/store/harnessLibraryStore";
import { useHarnessSessionStore } from "@/store/harnessSessionStore";

export type HarnessSwitchProps = {
  /** Kept for existing callers; the picker is always inline now. */
  embedded?: boolean;
  onOpenStudio?: () => void;
  onOpenProviders?: () => void;
};

type Option = { id: string | null; name: string; subtitle: string };

const NONE: Option = { id: null, name: "No harness", subtitle: "Direct conversation with the model" };

/**
 * One control for "which harness runs this conversation", in the composer
 * toolbar. "No harness" is the first option rather than a separate on/off
 * switch, so choosing and enabling are one gesture. The menu is portalled with
 * fixed positioning, so the composer's overflow can never clip it.
 */
export function HarnessSwitch({ onOpenStudio, onOpenProviders }: HarnessSwitchProps) {
  const enabled = useHarnessSessionStore((s) => s.enabled);
  const activeBundle = useHarnessSessionStore((s) => s.activeBundle);
  const hydrated = useHarnessSessionStore((s) => s.hydrated);
  const setEnabled = useHarnessSessionStore((s) => s.setEnabled);
  const hydrateSession = useHarnessSessionStore((s) => s.hydrate);

  const entries = useHarnessLibraryStore((s) => s.entries);
  const libraryHydrated = useHarnessLibraryStore((s) => s.hydrated);
  const hydrateLibrary = useHarnessLibraryStore((s) => s.hydrate);
  const activate = useHarnessLibraryStore((s) => s.activate);

  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(0);
  const [pos, setPos] = useState<{ left: number; bottom: number } | null>(null);
  const [error, setError] = useState("");
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  useEffect(() => {
    if (!hydrated) void hydrateSession().catch((err: Error) => setError(err.message));
  }, [hydrated, hydrateSession]);

  useEffect(() => {
    if (!libraryHydrated) void hydrateLibrary().catch((err: Error) => setError(err.message));
  }, [libraryHydrated, hydrateLibrary]);

  const options = useMemo<Option[]>(
    () => [
      NONE,
      ...entries.map((e) => ({ id: e.id, name: splitHarnessName(e.name).title, subtitle: harnessSubtitle(e) })),
    ],
    [entries],
  );

  const activeId = enabled ? (activeBundle?.manifest?.id ?? null) : null;
  const selectedIndex = Math.max(0, options.findIndex((o) => o.id === activeId));
  const activeName = activeBundle?.manifest?.name || activeBundle?.manifest?.id;
  const label = !enabled ? "No harness" : activeName ? splitHarnessName(activeName).title : hydrated ? "No harness" : "Loading…";

  const openMenu = () => {
    const r = triggerRef.current?.getBoundingClientRect();
    if (r) setPos({ left: r.left, bottom: window.innerHeight - r.top + 6 });
    setCursor(selectedIndex);
    setOpen(true);
  };

  const close = (refocus = true) => {
    setOpen(false);
    if (refocus) triggerRef.current?.focus();
  };

  const choose = (o: Option) => {
    if (o.id === null) {
      setEnabled(false);
    } else {
      activate(o.id);
      if (!enabled) setEnabled(true);
    }
    close();
  };

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!menuRef.current?.contains(t) && !triggerRef.current?.contains(t)) setOpen(false);
    };
    const onResize = () => setOpen(false);
    document.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("resize", onResize);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("resize", onResize);
    };
  }, [open]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!open) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        openMenu();
      }
      return;
    }
    const last = options.length - 1;
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setCursor((c) => Math.min(last, c + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor((c) => Math.max(0, c - 1));
    } else if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      setCursor(e.key === "Home" ? 0 : last);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      choose(options[cursor]);
    } else if (e.key === "Tab") {
      close(false);
    }
  };

  const menu =
    open &&
    pos &&
    createPortal(
      <div ref={menuRef} className="oh-float fixed z-50 w-[300px] py-1" style={{ left: pos.left, bottom: pos.bottom }}>
        <ul
          id={listId}
          role="listbox"
          aria-label="Harness"
          aria-activedescendant={`${listId}-${cursor}`}
          className="max-h-[min(360px,55vh)] overflow-y-auto"
        >
          {options.map((o, i) => {
            const selected = i === selectedIndex;
            return (
              <li
                key={o.id ?? "none"}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={selected}
                onMouseEnter={() => setCursor(i)}
                onClick={() => choose(o)}
                className="mx-1 flex cursor-pointer items-center gap-3 rounded-[6px] px-2.5 py-2"
                style={{
                  // Two colours, two meanings: the row already in use is
                  // teal (the Check below, --signal); the row the pointer
                  // is over — not chosen yet — is amber (Nilo's beak), so
                  // "what I'm about to pick" never reads as "what's active".
                  background:
                    i === cursor
                      ? "color-mix(in oklab, var(--nilo-beak) 16%, transparent)"
                      : undefined,
                }}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-[550] leading-5 text-ink">{o.name}</span>
                  <span className="block truncate text-[12px] leading-[18px] text-ink-mute">{o.subtitle}</span>
                </span>
                {selected && <Check size={14} strokeWidth={2} className="flex-none text-signal" />}
              </li>
            );
          })}
        </ul>
        {(onOpenStudio || onOpenProviders) && (
          <div className="mx-1 mt-1 flex flex-col border-t border-line-soft pt-1">
            {onOpenStudio && (
              <MenuAction
                onClick={() => {
                  close(false);
                  onOpenStudio();
                }}
              >
                Edit in Studio
              </MenuAction>
            )}
            {onOpenProviders && (
              <MenuAction
                onClick={() => {
                  close(false);
                  onOpenProviders();
                }}
              >
                Providers
              </MenuAction>
            )}
          </div>
        )}
      </div>,
      document.body,
    );

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={`Harness: ${label}`}
        onClick={() => (open ? close() : openMenu())}
        onKeyDown={onKeyDown}
        className="inline-flex h-8 max-w-[260px] items-center gap-1.5 rounded-[8px] px-2.5 text-[12px] font-[550] text-ink-dim transition-colors hover:bg-sub-200 hover:text-ink aria-expanded:bg-sub-200"
      >
        <Workflow size={14} strokeWidth={1.8} className={enabled ? "flex-none text-signal" : "flex-none text-ink-faint"} />
        <span className="min-w-0 truncate">{label}</span>
        <ChevronDown size={13} strokeWidth={1.8} className="flex-none text-ink-faint" />
      </button>
      {error && (
        <span className="max-w-[140px] truncate text-[11px] text-fault" title={error}>
          Couldn&apos;t load harnesses
        </span>
      )}
      {menu}
    </>
  );
}

function MenuAction({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-[6px] px-2.5 py-1.5 text-left text-[12px] font-[550] text-ink-mute transition-colors hover:bg-sub-300/70 hover:text-ink"
    >
      {children}
    </button>
  );
}
