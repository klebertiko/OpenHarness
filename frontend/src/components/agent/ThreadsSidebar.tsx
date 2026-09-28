"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { Archive, ArchiveRestore, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";

import { Panel } from "@/components/shell/Panel";
import { useThreadStore, type Thread } from "@/store/threadStore";

/**
 * The chat list beside the conversation. New chat on top, chats grouped by
 * recency, and a per-row menu for rename / archive / delete. Archived chats
 * live in a collapsed section at the bottom until restored or removed.
 */
export function ThreadsSidebar() {
  const threads = useThreadStore((s) => s.threads);
  const activeThreadId = useThreadStore((s) => s.activeThreadId);
  const startNewChat = useThreadStore((s) => s.startNewChat);
  const selectThread = useThreadStore((s) => s.selectThread);

  const open = useMemo(() => threads.filter((t) => !t.archived), [threads]);
  const archived = useMemo(() => threads.filter((t) => t.archived), [threads]);
  const groups = useMemo(() => groupByRecency(open), [open]);

  const [listFocused, setListFocused] = useState(false);

  const onNew = useCallback(() => startNewChat(), [startNewChat]);

  const onKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (open.length === 0 || (e.key !== "ArrowDown" && e.key !== "ArrowUp")) return;
      e.preventDefault();
      const ids = open.map((t) => t.id);
      const current = activeThreadId && ids.includes(activeThreadId) ? activeThreadId : ids[0];
      const idx = ids.indexOf(current);
      selectThread(e.key === "ArrowDown" ? ids[Math.min(idx + 1, ids.length - 1)] : ids[Math.max(idx - 1, 0)]);
    },
    [open, activeThreadId, selectThread],
  );

  return (
    <Panel title="Chats" className="h-full">
      <div className="px-2 pb-1 pt-2">
        <button
          type="button"
          onClick={onNew}
          aria-current={activeThreadId === null ? "true" : undefined}
          className={[
            "flex h-8 w-full items-center gap-2 rounded-[8px] px-2.5 text-[13px] font-[550] transition-colors",
            activeThreadId === null
              ? "bg-sub-300 text-ink"
              : "bg-sub-200 text-ink hover:bg-sub-300",
          ].join(" ")}
        >
          <Plus size={14} strokeWidth={2} className="text-ink-mute" />
          New chat
        </button>
      </div>

      {open.length === 0 && archived.length === 0 ? (
        <p className="px-3 py-3 text-[12px] text-ink-mute">No chats yet. Start one and it shows up here.</p>
      ) : (
        <div
          role="listbox"
          aria-label="Chats"
          tabIndex={0}
          onKeyDown={onKeyDown}
          onFocus={(e) => e.target === e.currentTarget && setListFocused(true)}
          onBlur={(e) => e.target === e.currentTarget && setListFocused(false)}
          className={`flex flex-col pb-2 outline-none ${listFocused ? "ring-1 ring-inset ring-signal/25" : ""}`}
        >
          {groups.map(({ label, items }) => (
            <section key={label} className="px-1.5 pt-2">
              <h3 className="px-2 pb-1 text-[11px] font-[550] text-ink-faint">{label}</h3>
              <ul className="flex flex-col gap-px">
                {items.map((thread) => (
                  <ThreadRow
                    key={thread.id}
                    thread={thread}
                    active={thread.id === activeThreadId}
                    onSelect={() => selectThread(thread.id)}
                  />
                ))}
              </ul>
            </section>
          ))}

          {archived.length > 0 && (
            <details className="mt-2 px-1.5">
              <summary className="cursor-pointer list-none px-2 py-1.5 text-[11px] font-[550] text-ink-faint marker:content-none hover:text-ink-mute">
                Archived · {archived.length}
              </summary>
              <ul className="flex flex-col gap-px pt-1">
                {archived.map((thread) => (
                  <ThreadRow
                    key={thread.id}
                    thread={thread}
                    active={thread.id === activeThreadId}
                    onSelect={() => selectThread(thread.id)}
                  />
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </Panel>
  );
}

function ThreadRow({ thread, active, onSelect }: { thread: Thread; active: boolean; onSelect: () => void }) {
  const renameThread = useThreadStore((s) => s.renameThread);
  const archiveThread = useThreadStore((s) => s.archiveThread);
  const restoreThread = useThreadStore((s) => s.restoreThread);
  const deleteThread = useThreadStore((s) => s.deleteThread);

  const [menuOpen, setMenuOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [draft, setDraft] = useState(thread.title);
  const rowRef = useRef<HTMLLIElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: PointerEvent) => {
      if (!rowRef.current?.contains(e.target as Node)) {
        setMenuOpen(false);
        setConfirmingDelete(false);
      }
    };
    const onEsc = (e: globalThis.KeyboardEvent) => e.key === "Escape" && setMenuOpen(false);
    // Defer binding so the click that opened the menu can't immediately close it.
    const id = window.setTimeout(() => {
      document.addEventListener("pointerdown", onDown);
      document.addEventListener("keydown", onEsc);
    }, 0);
    return () => {
      window.clearTimeout(id);
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onEsc);
    };
  }, [menuOpen]);

  useEffect(() => {
    if (editing) {
      setDraft(thread.title);
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing, thread.title]);

  const commitRename = () => {
    const next = draft.trim();
    if (next && next !== thread.title) renameThread(thread.id, next);
    setEditing(false);
  };

  return (
    <li ref={rowRef} role="option" aria-selected={active} className="group/row relative">
      {editing ? (
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitRename}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitRename();
            if (e.key === "Escape") setEditing(false);
          }}
          aria-label="Chat name"
          className="w-full rounded-[7px] border border-signal/50 bg-sub-200 px-2.5 py-1.5 text-[13px] text-ink outline-none"
        />
      ) : (
        <button
          type="button"
          onClick={onSelect}
          className={[
            "flex w-full items-center gap-2 rounded-[7px] px-2.5 py-1.5 text-left outline-none transition-colors focus-visible:ring-1 focus-visible:ring-signal",
            active ? "bg-sub-300/70" : "hover:bg-sub-200/70",
          ].join(" ")}
        >
          <span className={`min-w-0 flex-1 truncate text-[13px] leading-5 ${active ? "text-ink" : "text-ink-dim"}`}>
            {thread.title}
          </span>
          <span className="shrink-0 text-[11px] text-ink-faint group-hover/row:hidden">{relativeTime(thread.updatedAt)}</span>
        </button>
      )}

      {!editing && (
        <button
          type="button"
          aria-label="Chat actions"
          onClick={() => setMenuOpen((v) => !v)}
          className="absolute right-1.5 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-[6px] text-ink-mute opacity-0 transition-opacity hover:bg-sub-300 hover:text-ink hover:opacity-100 focus-visible:opacity-100 group-hover/row:opacity-100 group-focus-within/row:opacity-100 aria-expanded:opacity-100"
          aria-expanded={menuOpen}
        >
          <MoreHorizontal size={15} strokeWidth={1.8} />
        </button>
      )}

      {menuOpen && (
        <div className="oh-float absolute right-1.5 top-[calc(100%-2px)] z-40 w-[168px] p-1" role="menu">
          {confirmingDelete ? (
            <div className="px-2 py-1.5">
              <p className="pb-1.5 text-[12px] text-ink-mute">Delete this chat?</p>
              <div className="flex gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    deleteThread(thread.id);
                    setMenuOpen(false);
                  }}
                  className="h-7 flex-1 rounded-[6px] bg-fault px-2 text-[12px] font-[550] text-[color:var(--sub-000)]"
                >
                  Delete
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmingDelete(false)}
                  className="h-7 flex-1 rounded-[6px] border border-line px-2 text-[12px] text-ink-mute hover:text-ink"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <>
              <MenuItem icon={Pencil} onClick={() => { setEditing(true); setMenuOpen(false); }}>
                Rename
              </MenuItem>
              {thread.archived ? (
                <MenuItem icon={ArchiveRestore} onClick={() => { restoreThread(thread.id); setMenuOpen(false); }}>
                  Restore
                </MenuItem>
              ) : (
                <MenuItem icon={Archive} onClick={() => { archiveThread(thread.id); setMenuOpen(false); }}>
                  Archive
                </MenuItem>
              )}
              <MenuItem icon={Trash2} danger onClick={() => setConfirmingDelete(true)}>
                Delete
              </MenuItem>
            </>
          )}
        </div>
      )}
    </li>
  );
}

function MenuItem({
  icon: Icon,
  children,
  onClick,
  danger = false,
}: {
  icon: typeof Pencil;
  children: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={[
        "flex w-full items-center gap-2 rounded-[6px] px-2 py-1.5 text-left text-[12px] font-[500] transition-colors",
        danger ? "text-fault hover:bg-fault/12" : "text-ink-mute hover:bg-sub-300/70 hover:text-ink",
      ].join(" ")}
    >
      <Icon size={13} strokeWidth={1.8} />
      {children}
    </button>
  );
}

const DAY = 86_400_000;

function groupByRecency(threads: Thread[]): { label: string; items: Thread[] }[] {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const buckets: { label: string; items: Thread[] }[] = [
    { label: "Today", items: [] },
    { label: "Yesterday", items: [] },
    { label: "Previous 7 days", items: [] },
    { label: "Older", items: [] },
  ];
  for (const t of threads) {
    if (t.updatedAt >= startOfToday) buckets[0].items.push(t);
    else if (t.updatedAt >= startOfToday - DAY) buckets[1].items.push(t);
    else if (t.updatedAt >= startOfToday - 7 * DAY) buckets[2].items.push(t);
    else buckets[3].items.push(t);
  }
  return buckets.filter((b) => b.items.length > 0);
}

function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return "now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`;
  if (diff < DAY) return `${Math.floor(diff / 3_600_000)}h`;
  if (diff < 7 * DAY) return `${Math.floor(diff / DAY)}d`;
  try {
    return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(ts);
  } catch {
    return "";
  }
}
