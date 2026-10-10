"use client";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

/**
 * A small action menu: one button, one popup of items.
 *
 * It follows the WAI-ARIA menu-button pattern: the button has
 * `aria-haspopup="menu"`, opening lands focus on the first enabled item, arrows
 * / Home / End move between items, Escape closes and returns focus to the
 * button, and a click elsewhere closes. Items that carry a `checked` state are
 * `menuitemradio`s.
 */

const MenuContext = createContext<{ close: () => void }>({ close: () => {} });

const focusRing = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-signal";
const ITEM = '[role^="menuitem"]:not(:disabled)';

interface MenuProps {
  /** Accessible name of both the button and the popup. */
  label: string;
  trigger: ReactNode;
  triggerClassName?: string;
  triggerTitle?: string;
  disabled?: boolean;
  align?: "start" | "end";
  children: ReactNode;
}

export function Menu({ label, trigger, triggerClassName = "", triggerTitle, disabled, align = "start", children }: MenuProps) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLDivElement>(null);

  const close = useCallback(() => {
    setOpen(false);
    // Synchronously, so a form an item opens can still take focus afterwards.
    button.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    popup.current?.querySelector<HTMLElement>(ITEM)?.focus();
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const onKeyDown = (e: KeyboardEvent) => {
    const items = Array.from(popup.current?.querySelectorAll<HTMLElement>(ITEM) ?? []);
    const at = items.indexOf(document.activeElement as HTMLElement);
    const go = (i: number) => {
      e.preventDefault();
      items[(i + items.length) % items.length]?.focus();
    };
    if (e.key === "ArrowDown") go(at + 1);
    else if (e.key === "ArrowUp") go(at < 0 ? items.length - 1 : at - 1);
    else if (e.key === "Home") go(0);
    else if (e.key === "End") go(items.length - 1);
    else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (e.key === "Tab") setOpen(false);
  };

  return (
    <div ref={root} className="relative">
      <button
        ref={button}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        title={triggerTitle}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" && !open) {
            e.preventDefault();
            setOpen(true);
          }
        }}
        className={`${triggerClassName} ${focusRing}`}
      >
        {trigger}
      </button>
      {open && (
        <MenuContext.Provider value={{ close }}>
          <div
            ref={popup}
            role="menu"
            aria-label={label}
            onKeyDown={onKeyDown}
            className={`absolute top-full z-40 mt-1 min-w-[220px] max-w-[min(340px,85vw)] overflow-hidden rounded-[10px] border border-line bg-sub-100 py-1 shadow-lg ${align === "end" ? "right-0" : "left-0"}`}
          >
            {children}
          </div>
        </MenuContext.Provider>
      )}
    </div>
  );
}

interface ItemProps {
  onSelect: () => void;
  children: ReactNode;
  icon?: ReactNode;
  /** Secondary text on the right: a shortcut or a short fact. */
  hint?: ReactNode;
  disabled?: boolean;
  /** Present for a choice that is on or off; turns the item into a menuitemradio. */
  checked?: boolean;
  /** Do not close the menu after selecting. */
  keepOpen?: boolean;
  danger?: boolean;
  expanded?: boolean;
}

export function MenuItem({ onSelect, children, icon, hint, disabled, checked, keepOpen, danger, expanded }: ItemProps) {
  const { close } = useContext(MenuContext);
  return (
    <button
      type="button"
      role={checked === undefined ? "menuitem" : "menuitemradio"}
      aria-checked={checked}
      aria-expanded={expanded}
      tabIndex={-1}
      disabled={disabled}
      onClick={() => {
        onSelect();
        if (!keepOpen) close();
      }}
      className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] transition-colors hover:bg-sub-200 disabled:cursor-not-allowed disabled:opacity-40 ${danger ? "text-fault" : "text-ink"} ${focusRing}`}
    >
      <span aria-hidden className="grid h-4 w-4 flex-none place-items-center text-ink-mute">
        {checked ? <span className="h-1.5 w-1.5 rounded-full bg-signal" /> : icon}
      </span>
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {hint && <span aria-hidden className="flex-none text-[11px] text-ink-faint">{hint}</span>}
    </button>
  );
}

export function MenuSeparator() {
  return <div role="separator" className="my-1 h-px bg-line-soft" />;
}

export function MenuHeading({ children }: { children: ReactNode }) {
  return <div role="presentation" className="px-3 pb-1 pt-1.5 text-[11px] text-ink-faint">{children}</div>;
}
