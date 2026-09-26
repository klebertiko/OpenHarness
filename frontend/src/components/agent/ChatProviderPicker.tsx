
"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check } from "lucide-react";

import { chatProviderOptions, chatProviderStatus, pickChatProvider, type ChatProviderTone } from "@/components/agent/chatProvider";
import { formatRelativeTime } from "@/components/git/time";
import { useProviderStore } from "@/components/providers/providerStore";
import { useChatProviderStore } from "@/store/chatProviderStore";

/** Dropdown-row dot per tone. Mirrors the trigger chip's own `dotClass`
 * convention (filled circle, `bg-*` token) with two additions the row list
 * needs and the single-selection chip doesn't: a distinct pulsing "checking"
 * state, and a hollow ring for "unconfigured" — never the same filled dot as
 * "failing", so a credential that was tried and rejected never looks like a
 * connection nobody has configured yet. Deliberately local to this file
 * rather than the shared `StatusDot` (`components/shell/ListRow.tsx`): that
 * component paints its dot via inline `style`, not a token class, and its
 * `Tone` union has no room for this six-way split.
 */
function toneDotClass(tone: ChatProviderTone): string {
  switch (tone) {
    case "verified": return "bg-signal";
    case "attention": return "bg-warn";
    case "checking": return "bg-ink-faint animate-pulse";
    case "failing": return "bg-fault";
    case "unverified": return "bg-ink-faint";
    case "unconfigured": return "border border-ink-faint";
  }
}

/* Hallmark · component: provider picker · design-system: design.md
 * Selection, enabled eligibility and probe evidence have separate meanings.
 */
export function ChatProviderPicker({ onConnect }: { onConnect: () => void }) {
  const connections = useProviderStore((s) => s.connections);
  const selectConnection = useProviderStore((s) => s.select);
  const chosenId = useChatProviderStore((s) => s.chosenId);
  const setChosen = useChatProviderStore((s) => s.setChosen);
  const provider = useMemo(() => pickChatProvider(connections, chosenId), [connections, chosenId]);
  const options = useMemo(() => {
    const rows = chatProviderOptions(connections);
    if (chosenId && !connections.some((c) => c.id === chosenId)) {
      rows.push({ id: chosenId, label: "Unavailable provider", detail: "Connection no longer available", ready: false, tone: "unconfigured" });
    }
    return rows;
  }, [connections, chosenId]);
  const selectedIndex = Math.max(0, options.findIndex((o) => o.id === chosenId));
  const connection = connections.find((c) => c.id === (chosenId ?? provider?.id));
  const status = connection ? chatProviderStatus(connection) : "Unavailable";
  const label = chosenId
    ? connection?.label ?? "Unavailable provider"
    : provider ? "Auto · " + provider.label : "Auto · No available provider";
  const verified = Boolean(provider && connection?.health === "live");
  const dotClass = verified ? "bg-signal" : status === "Unavailable" || status === "Needs attention" ? "bg-warn" : "bg-ink-faint";
  // A probe in flight must not look identical to "never verified" — same
  // neutral dot, but pulsing. Keyed off `status` (not raw health) so the
  // animation can never disagree with the text next to it. Mirrors the
  // StatusDot(tone, pulse) precedent ProvidersList.tsx already uses for
  // this exact state (see components/shell/ListRow.tsx).
  const probing = status === "Checking connection";
  // lastProbe is real evidence already on Connection but was never shown
  // anywhere. Surface it only when it exists, so an unprobed connection
  // (lastProbe: "") never grows an invented timestamp.
  const lastChecked = connection?.lastProbe ? "checked " + formatRelativeTime(connection.lastProbe) : null;
  const statusLine = label + " · " + status + (lastChecked ? " · " + lastChecked : "");

  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(0);
  const [pos, setPos] = useState<{ left: number; bottom: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const listId = useId();
  const activeOption = options[cursor] ?? options[selectedIndex];
  const configureId = activeOption.id ?? pickChatProvider(connections)?.id;
  const configureTarget = connections.find((c) => c.id === configureId);

  const openMenu = () => {
    const r = triggerRef.current?.getBoundingClientRect();
    const width = Math.min(300, window.innerWidth - 16);
    if (r) setPos({
      left: Math.max(8, Math.min(r.left, window.innerWidth - width - 8)),
      bottom: Math.max(8, window.innerHeight - r.top + 6),
    });
    setCursor(selectedIndex);
    setOpen(true);
  };
  const close = (refocus = true) => {
    setOpen(false);
    if (refocus) triggerRef.current?.focus();
  };
  const choose = (index: number) => {
    const option = options[index];
    if (!option?.ready) return;
    setChosen(option.id);
    close();
  };

  useEffect(() => {
    if (!open) return;
    listRef.current?.focus();
    const onDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (!menuRef.current?.contains(target) && !triggerRef.current?.contains(target)) setOpen(false);
    };
    const onResize = () => setOpen(false);
    document.addEventListener("pointerdown", onDown);
    window.addEventListener("resize", onResize);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      window.removeEventListener("resize", onResize);
    };
  }, [open]);

  useEffect(() => {
    setCursor((current) => Math.min(current, options.length - 1));
  }, [options.length]);

  useEffect(() => {
    if (open) document.getElementById(listId + "-" + cursor)?.scrollIntoView?.({ block: "nearest" });
  }, [open, cursor, listId]);

  const onMenuKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
      return;
    }
    if (e.target !== listRef.current) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setCursor((c) => Math.max(0, Math.min(options.length - 1, c + (e.key === "ArrowDown" ? 1 : -1))));
    } else if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      setCursor(e.key === "Home" ? 0 : options.length - 1);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      choose(cursor);
    } else if (e.key === "Tab" && e.shiftKey) {
      e.preventDefault();
      close();
    }
  };

  const menu = open && pos && createPortal(
    <div
      ref={menuRef}
      role="dialog"
      aria-label="Choose a chat provider"
      onKeyDown={onMenuKeyDown}
      onBlur={(e) => {
        if (e.relatedTarget && !e.currentTarget.contains(e.relatedTarget as Node) && e.relatedTarget !== triggerRef.current) close(false);
      }}
      className="oh-float fixed z-50 w-[min(300px,calc(100vw-16px))] py-1"
      style={{ left: pos.left, bottom: pos.bottom }}
    >
      <p className="px-3 py-2 text-[11px] leading-4 text-ink-dim">
        Chat default. Agents with a pinned connection use their own provider.
      </p>
      <ul
        ref={listRef}
        id={listId}
        role="listbox"
        tabIndex={0}
        aria-label="Chat provider"
        aria-activedescendant={listId + "-" + cursor}
        className="max-h-[min(280px,40vh)] overflow-y-auto rounded-control focus-visible:outline focus-visible:outline-2 focus-visible:outline-signal"
      >
        {options.map((o, i) => (
          <li
            key={o.id ?? "auto"}
            id={listId + "-" + i}
            role="option"
            aria-selected={i === selectedIndex}
            aria-disabled={!o.ready}
            onMouseEnter={() => setCursor(i)}
            onClick={() => { setCursor(i); choose(i); }}
            className={[
              "mx-1 flex items-center gap-2.5 rounded-control px-2.5 py-2",
              i === cursor ? "bg-sub-300/70" : "",
              o.ready ? "cursor-pointer active:bg-sub-300" : "cursor-default",
            ].join(" ")}
          >
            <span className={"h-1.5 w-1.5 flex-none rounded-full " + toneDotClass(o.tone)} aria-hidden />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-[550] leading-5 text-ink">{o.label}</span>
              <span className="block truncate text-[11px] leading-4 text-ink-dim">{o.detail}</span>
            </span>
            {i === selectedIndex && <Check size={14} strokeWidth={2} className="flex-none text-ink-dim" aria-hidden />}
          </li>
        ))}
      </ul>
      <div className="mt-1 border-t border-line-soft px-2 py-1.5">
        <button
          type="button"
          onClick={() => {
            if (configureTarget) selectConnection(configureTarget.id);
            close();
            onConnect();
          }}
          className="flex h-8 w-full items-center rounded-control px-2 text-[12px] font-[550] text-ink hover:bg-sub-200 active:bg-sub-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-signal"
        >
          <span className="truncate">{configureTarget ? "Configure " + configureTarget.label : "Manage providers"}</span>
        </button>
      </div>
    </div>,
    document.body,
  );

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={"Chat provider: " + statusLine}
        title={statusLine}
        onClick={() => (open ? close() : openMenu())}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            openMenu();
          }
        }}
        className="inline-flex h-8 min-w-0 max-w-[260px] items-center gap-1.5 rounded-control px-2 text-[11px] font-[550] text-ink-dim transition-colors hover:bg-sub-200 active:bg-sub-300 aria-expanded:bg-sub-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-signal"
      >
        <span className={"h-1.5 w-1.5 flex-none rounded-full " + dotClass + (probing ? " animate-pulse" : "")} aria-hidden />
        <span className="min-w-0 truncate">{label} · {status}</span>
      </button>
      {menu}
    </>
  );
}
