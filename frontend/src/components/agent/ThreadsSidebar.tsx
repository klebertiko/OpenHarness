"use client";

import { useCallback, useRef, useState, type KeyboardEvent } from "react";
import { MessageSquarePlus, Plus } from "lucide-react";

import { Panel } from "@/components/shell/Panel";
import { useThreadStore, type Thread } from "@/store/threadStore";

/**
 * Agent master list — Cursor-style threads beside Chat.
 * ↑/↓ move selection when the list is focused; Enter is selection (click).
 */
export function ThreadsSidebar() {
  const threads = useThreadStore((s) => s.threads);
  const activeThreadId = useThreadStore((s) => s.activeThreadId);
  const createThread = useThreadStore((s) => s.createThread);
  const selectThread = useThreadStore((s) => s.selectThread);

  const listRef = useRef<HTMLUListElement>(null);
  const [listFocused, setListFocused] = useState(false);

  const onNew = useCallback(() => {
    createThread();
  }, [createThread]);

  const onKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (threads.length === 0) return;
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;

      e.preventDefault();
      const ids = threads.map((t) => t.id);
      const current = activeThreadId && ids.includes(activeThreadId) ? activeThreadId : ids[0];
      const idx = ids.indexOf(current);
      const next =
        e.key === "ArrowDown"
          ? ids[Math.min(idx + 1, ids.length - 1)]
          : ids[Math.max(idx - 1, 0)];
      selectThread(next);
    },
    [threads, activeThreadId, selectThread]
  );

  return (
    <Panel
      title="Threads"
      meta={threads.length > 0 ? `${threads.length}` : undefined}
      className="h-full"
      actions={
        <button
          type="button"
          title="New chat"
          onClick={onNew}
          className="inline-flex h-[22px] items-center gap-1 rounded-control border border-line bg-sub-200 px-1.5 text-[11px] font-[550] text-ink-dim transition hover:bg-sub-300 hover:text-ink"
        >
          <Plus size={11} strokeWidth={1.8} />
          New
        </button>
      }
    >
      {threads.length === 0 ? (
        <EmptyThreads onNew={onNew} />
      ) : (
        <ul
          ref={listRef}
          role="listbox"
          aria-label="Threads"
          tabIndex={0}
          onKeyDown={onKeyDown}
          onFocus={() => setListFocused(true)}
          onBlur={() => setListFocused(false)}
          className={[
            "oh-focus-inner flex flex-col outline-none",
            listFocused ? "ring-1 ring-inset ring-signal/30" : "",
          ].join(" ")}
        >
          {threads.map((thread) => (
            <ThreadRow
              key={thread.id}
              thread={thread}
              active={thread.id === activeThreadId}
              onSelect={() => selectThread(thread.id)}
            />
          ))}
        </ul>
      )}
    </Panel>
  );
}

function EmptyThreads({ onNew }: { onNew: () => void }) {
  return (
    <div className="flex h-full min-h-[120px] flex-col items-stretch justify-center gap-3 p-3">
      <p className="t-body text-ink-mute">No chats yet. Start one to pin a thread here.</p>
      <button
        type="button"
        onClick={onNew}
        className="inline-flex h-8 items-center justify-center gap-2 rounded-control bg-signal px-2.5 text-[12px] font-[550] text-signal-ink transition hover:opacity-90"
      >
        <MessageSquarePlus size={14} strokeWidth={1.7} />
        New chat
      </button>
    </div>
  );
}

function ThreadRow({
  thread,
  active,
  onSelect,
}: {
  thread: Thread;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <li role="option" aria-selected={active}>
      <button
        type="button"
        onClick={onSelect}
        className={[
          "oh-focus-inner flex w-full flex-col gap-0.5 border-b border-line-soft px-2.5 py-2 text-left transition-colors last:border-b-0",
          active ? "bg-sub-300" : "hover:bg-sub-200",
        ].join(" ")}
      >
        <span className={["t-title truncate", active ? "text-ink" : "text-ink-dim"].join(" ")}>
          {thread.title}
        </span>
        <span className="t-meta truncate text-ink-faint">{formatUpdated(thread.updatedAt)}</span>
      </button>
    </li>
  );
}

function formatUpdated(ts: number): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(ts);
  } catch {
    return "";
  }
}
