
"use client";

import { Fragment, useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check } from "lucide-react";

import {
  chatProviderOptions,
  pickChatProvider,
  rowStatus,
  type ChatProviderTone,
} from "@/components/agent/chatProvider";
import { formatRelativeTime } from "@/lib/time";
import { prefixMatches } from "@/components/providers/secrets";
import { specOf, useProviderStore } from "@/components/providers/providerStore";
import { useChatProviderStore } from "@/store/chatProviderStore";
import { useChatSetupRequestStore } from "@/store/chatSetupStore";

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

/** One compact control, scoped to a single not-ready connection: a password
 * field for an `api-key` credential, a single switch for anything else
 * (a CLI session or no credential at all). Mounted only while this row is
 * expanded, so it always reads live store state rather than a snapshot
 * captured when the menu opened — health flips from `probing` to `live` or
 * `fault` while this stays open. design.md § Provider stance: fix it in
 * place, state the real outcome, never fake a success.
 */
function InlineSetup({ id, onOpenProviders }: { id: string; onOpenProviders: () => void }) {
  const connection = useProviderStore((s) => s.connections.find((c) => c.id === id));
  const attachSecret = useProviderStore((s) => s.attachSecret);
  const toggleEnabled = useProviderStore((s) => s.toggleEnabled);
  const probe = useProviderStore((s) => s.probe);

  const input = useRef<HTMLInputElement>(null);
  const switchRef = useRef<HTMLButtonElement>(null);
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [len, setLen] = useState(0);
  const [prefixOk, setPrefixOk] = useState(true);

  const keyed = connection ? specOf(connection).credential.kind === "api-key" : false;

  useEffect(() => {
    (keyed ? input.current : switchRef.current)?.focus();
    // Only on mount — this component is remounted fresh each time a
    // different row expands (see the `key` on its parent `<li>`).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!connection) return null;
  const spec = specOf(connection);
  const probing = connection.health === "probing";
  const ready = connection.enabled && connection.health !== "fault";
  const failed = connection.health === "fault";

  const runKeyed = async () => {
    const value = input.current?.value.trim();
    if (!value || busy) return;
    setBusy(true);
    setSaveError(false);
    try {
      await attachSecret(id, value);
      const after = useProviderStore.getState().connections.find((c) => c.id === id);
      if (after && !after.enabled) await toggleEnabled(id);
      await probe(id);
    } catch {
      // Generic on purpose: the thrown text may carry the pasted value.
      setSaveError(true);
    } finally {
      if (input.current) input.current.value = "";
      setLen(0);
      setBusy(false);
    }
  };

  const runKeyless = async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (!connection.enabled) await toggleEnabled(id);
      await probe(id);
    } finally {
      setBusy(false);
    }
  };

  const expected = spec.credential.prefix;

  return (
    <li
      role="presentation"
      className="mx-1 mb-1 rounded-control bg-sub-200 px-2.5 py-2.5"
    >
      {keyed ? (
        <>
          <label htmlFor="oh-combo-cred" className="mb-1 block text-[11px] font-[550] text-ink-faint">
            Paste {spec.vendor} key
          </label>
          <div className="flex gap-1.5">
            <input
              id="oh-combo-cred"
              ref={input}
              type="password"
              autoComplete="off"
              spellCheck={false}
              data-1p-ignore
              placeholder={expected ? `${expected}…` : "key"}
              onChange={(e) => {
                const v = e.currentTarget.value;
                setLen(v.length);
                setPrefixOk(prefixMatches(v, expected));
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void runKeyed();
                }
              }}
              className="oh-focus-inner h-7 min-w-0 flex-1 rounded-control border border-line-soft bg-sub-100 px-2 text-[12px] tracking-[0.1em] text-ink outline-none focus:border-signal-deep"
            />
            <button
              type="button"
              onClick={() => void runKeyed()}
              disabled={!len || !prefixOk || busy || probing}
              className="h-7 flex-none rounded-control bg-signal px-2.5 text-[12px] font-[550] text-signal-ink transition-colors hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busy || probing ? "Connecting…" : "Connect"}
            </button>
          </div>
          {!prefixOk && (
            <p className="mt-1.5 text-[11px] text-warn">
              {spec.vendor} keys begin {expected}. This one does not.
            </p>
          )}
        </>
      ) : (
        <button
          ref={switchRef}
          type="button"
          onClick={() => void runKeyless()}
          disabled={busy || probing}
          className="h-7 w-full rounded-control bg-signal text-[12px] font-[550] text-signal-ink transition-colors hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy || probing ? "Checking…" : connection.enabled ? "Test again" : `Turn on ${connection.label}`}
        </button>
      )}

      {saveError && (
        <p className="mt-1.5 text-[11px] text-fault">Couldn&apos;t save the key. Check the app is running and try again.</p>
      )}
      {probing && <p className="mt-1.5 text-[11px] text-ink-dim">Checking connection…</p>}
      {!probing && ready && <p className="mt-1.5 text-[11px] text-signal">Verified.</p>}
      {!probing && failed && <p className="mt-1.5 text-[11px] text-fault">{connection.detail}</p>}

      <button
        type="button"
        onClick={onOpenProviders}
        className="mt-1.5 text-[11px] text-ink-faint underline-offset-2 hover:text-ink-dim hover:underline"
      >
        Open in Providers
      </button>
    </li>
  );
}

/* Hallmark · component: provider picker · design-system: design.md
 * Selection, enabled eligibility and probe evidence have separate meanings.
 * Pre-emit critique: P5 H4 E4 S5 R4 V5 — any row is choosable and a not-ready
 * pick fixes itself inline (the position this component exists to prove);
 * E/R held at 4 rather than 5 because the inline setup form necessarily adds
 * a second density tier to a trigger that used to be one line — accepted,
 * since design.md rules out ever sending the choice to another screen.
 */
export function ChatProviderPicker({ onConnect }: { onConnect: () => void }) {
  const connections = useProviderStore((s) => s.connections);
  const selectConnection = useProviderStore((s) => s.select);
  const chosenId = useChatProviderStore((s) => s.chosenId);
  const setChosen = useChatProviderStore((s) => s.setChosen);
  const setupRequestToken = useChatSetupRequestStore((s) => s.token);
  const setupRequestId = useChatSetupRequestStore((s) => s.id);
  const provider = useMemo(() => pickChatProvider(connections, chosenId), [connections, chosenId]);
  const options = useMemo(() => {
    const rows = chatProviderOptions(connections);
    if (chosenId && !connections.some((c) => c.id === chosenId)) {
      rows.push({ id: chosenId, label: "Unavailable provider", detail: "Connection no longer available", ready: false, tone: "unconfigured" });
    }
    // Grouped, not just listed: every ready row before every row that needs
    // setup, so "what can I use right now" reads as one glance rather than a
    // scan. Only worth labelling when the split is real — see render below.
    return [...rows.filter((r) => r.ready), ...rows.filter((r) => !r.ready)];
  }, [connections, chosenId]);
  const readyCount = options.filter((o) => o.ready).length;
  const showGroupLabels = readyCount > 0 && readyCount < options.length;
  const selectedIndex = Math.max(0, options.findIndex((o) => o.id === chosenId));
  const connection = connections.find((c) => c.id === (chosenId ?? provider?.id));
  const status = connection ? rowStatus(connection) : "Unavailable";
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
  const [setupId, setSetupId] = useState<string | null>(null);
  const [pos, setPos] = useState<{ left: number; bottom: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const listId = useId();

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
    setSetupId(null);
    if (refocus) triggerRef.current?.focus();
  };
  /* design.md § Provider stance: any row is choosable. Choosing it always
   * sets it as the chat default — ready or not (never a dead click, never
   * gated behind readiness). A not-ready row with a real connection behind
   * it then opens its fix-it form right here instead of closing; choosing
   * it again collapses that form without un-choosing it. A row with no
   * backing connection (the stale "Unavailable provider" placeholder) has
   * nothing to fix in place, so it behaves like a ready pick: select and
   * close. */
  const choose = (index: number) => {
    const option = options[index];
    if (!option) return;
    setChosen(option.id);
    const target = option.id ? connections.find((c) => c.id === option.id) : undefined;
    if (option.ready || !target) {
      setSetupId(null);
      close();
      return;
    }
    setSetupId((current) => (current === option.id ? null : option.id));
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

  // An external control (the composer's "what's missing" action) asked this
  // combo to open and, when it names a connection, jump straight to that
  // row's fix-it form — the same "fix it in place" promise, reachable from
  // outside the trigger chip. `token` fires even on a repeat request for
  // the same id.
  useEffect(() => {
    if (setupRequestToken === 0) return;
    openMenu();
    if (setupRequestId) {
      setSetupId(setupRequestId);
      const i = options.findIndex((o) => o.id === setupRequestId);
      if (i >= 0) setCursor(i);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setupRequestToken]);

  const onMenuKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      if (setupId) {
        setSetupId(null);
        listRef.current?.focus();
        return;
      }
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
        className="max-h-[min(340px,45vh)] overflow-y-auto rounded-control focus-visible:outline focus-visible:outline-2 focus-visible:outline-signal"
      >
        {options.map((o, i) => (
          <Fragment key={o.id ?? "auto"}>
            {showGroupLabels && i === 0 && (
              <li role="presentation" className="px-3 pb-1 pt-2 text-[11px] font-[550] text-ink-faint">Ready</li>
            )}
            {showGroupLabels && i === readyCount && (
              <li role="presentation" className="px-3 pb-1 pt-2 text-[11px] font-[550] text-ink-faint">Needs setup</li>
            )}
            <li
              id={listId + "-" + i}
              role="option"
              aria-selected={i === selectedIndex}
              onMouseEnter={() => setCursor(i)}
              onClick={() => { setCursor(i); choose(i); }}
              className={[
                "mx-1 flex items-center gap-2.5 rounded-control px-2.5 py-2",
                i === cursor ? "bg-sub-300/70" : "",
                "cursor-pointer active:bg-sub-300",
              ].join(" ")}
            >
              <span className={"h-1.5 w-1.5 flex-none rounded-full " + toneDotClass(o.tone)} aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-[550] leading-5 text-ink">{o.label}</span>
                <span className="block truncate text-[11px] leading-4 text-ink-dim">{o.detail}</span>
              </span>
              {!o.ready && o.id && connections.some((c) => c.id === o.id) && (
                <span className="flex-none text-[11px] font-[550] text-signal">
                  {setupId === o.id ? "Hide" : "Set up"}
                </span>
              )}
              {i === selectedIndex && <Check size={14} strokeWidth={2} className="flex-none text-ink-dim" aria-hidden />}
            </li>
            {setupId === o.id && o.id && connections.some((c) => c.id === o.id) && (
              <InlineSetup
                id={o.id}
                onOpenProviders={() => {
                  selectConnection(o.id as string);
                  close();
                  onConnect();
                }}
              />
            )}
          </Fragment>
        ))}
      </ul>
      <div className="mt-1 border-t border-line-soft px-2 py-1.5">
        <button
          type="button"
          onClick={() => {
            if (chosenId) selectConnection(chosenId);
            close();
            onConnect();
          }}
          className="flex h-8 w-full items-center rounded-control px-2 text-[12px] font-[550] text-ink hover:bg-sub-200 active:bg-sub-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-signal"
        >
          <span className="truncate">Manage providers</span>
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
