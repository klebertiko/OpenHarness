"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Folder, FolderPlus } from "lucide-react";

import { chosenWorkspace, useWorkspaceStore } from "@/store/workspaceStore";
import { nativeDialogAvailable, pickFolder } from "@/lib/nativeDialog";

/**
 * The composer chip for "where this chat works" — a Cowork project's
 * `rootPath`, threaded through to `POST /execute/` as `cwd` so a CLI-backed
 * adapter's `resolve_cwd()` actually receives one instead of always falling
 * back to the app-owned scratch directory (confirmed live, 2026-09-12: no
 * caller populated `extra["cwd"]` anywhere in the request path — every run
 * operated outside the person's real project regardless of what Cowork
 * already let them configure). Reuses the existing Cowork project concept
 * rather than inventing a parallel "workspace" entity; "No folder" is a
 * first-class, honestly-labelled option, not an error state.
 *
 * "Add folder…" is the only way to register a project today — there is no
 * Cowork-project screen wired into the shell (`CoworkPanel.tsx` exists but
 * is not mounted by any route/section), so this picker has to be able to
 * create one itself rather than just choosing among ones that already
 * exist. It opens the OS's own folder dialog (desktop shell only — the
 * browser dev preview has no native picker to open, and says so rather than
 * silently doing nothing).
 */
export function WorkspacePicker() {
  const projects = useWorkspaceStore((s) => s.projects);
  const chosenId = useWorkspaceStore((s) => s.chosenProjectId);
  const setChosen = useWorkspaceStore((s) => s.setChosen);
  const hydrate = useWorkspaceStore((s) => s.hydrate);
  const addProject = useWorkspaceStore((s) => s.addProject);
  const chosen = useWorkspaceStore(chosenWorkspace);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  const [adding, setAdding] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const options = useMemo(
    () => [
      { id: null as string | null, label: "No folder", detail: "runs in a scratch directory" },
      ...projects.map((p) => ({ id: p.id as string | null, label: p.name, detail: p.rootPath || "(no path set)" })),
    ],
    [projects],
  );

  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(0);
  const [pos, setPos] = useState<{ left: number; bottom: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  const selectedIndex = Math.max(0, options.findIndex((o) => o.id === chosenId));

  const openMenu = () => {
    const r = triggerRef.current?.getBoundingClientRect();
    if (r) setPos({ left: r.left, bottom: window.innerHeight - r.top + 6 });
    setCursor(selectedIndex);
    setNotice(null);
    setOpen(true);
  };
  const close = (refocus = true) => {
    setOpen(false);
    if (refocus) triggerRef.current?.focus();
  };
  const choose = (id: string | null) => {
    setChosen(id);
    close();
  };

  const onAddFolder = async () => {
    setNotice(null);
    if (!nativeDialogAvailable()) {
      setNotice("Available in the desktop app");
      return;
    }
    const path = await pickFolder();
    if (!path) return; // cancelled in the OS dialog — stay open, nothing to report
    setAdding(true);
    const name = path.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || path;
    const id = await addProject({ name, rootPath: path });
    setAdding(false);
    if (id) {
      close();
    } else {
      setNotice("Couldn't add that folder — try again");
    }
  };

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!menuRef.current?.contains(t) && !triggerRef.current?.contains(t)) setOpen(false);
    };
    const onResize = () => setOpen(false);
    document.addEventListener("pointerdown", onDown);
    window.addEventListener("resize", onResize);
    return () => {
      document.removeEventListener("pointerdown", onDown);
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
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      choose(options[cursor].id);
    } else if (e.key === "Tab") {
      close(false);
    }
  };

  const label = chosen ? chosen.name : "No folder";

  const menu =
    open &&
    pos &&
    createPortal(
      <div ref={menuRef} className="oh-float fixed z-50 w-[280px] py-1" style={{ left: pos.left, bottom: pos.bottom }}>
        <ul id={listId} role="listbox" aria-label="Chat working folder" aria-activedescendant={`${listId}-${cursor}`} className="max-h-[min(320px,50vh)] overflow-y-auto">
          {options.map((o, i) => {
            const selected = i === selectedIndex;
            return (
              <li
                key={o.id ?? "none"}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={selected}
                onMouseEnter={() => setCursor(i)}
                onClick={() => choose(o.id)}
                className={[
                  "mx-1 flex cursor-pointer items-center gap-2.5 rounded-[6px] px-2.5 py-1.5",
                  i === cursor ? "bg-sub-300/70" : "",
                ].join(" ")}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-[550] leading-5 text-ink">{o.label}</span>
                  <span className="block truncate text-[11px] leading-4 text-ink-mute">{o.detail}</span>
                </span>
                {selected && <Check size={14} strokeWidth={2} className="flex-none text-signal" />}
              </li>
            );
          })}
        </ul>
        <div className="mx-1 mt-1 border-t border-line-soft pt-1">
          <button
            type="button"
            onClick={() => void onAddFolder()}
            disabled={adding}
            className="flex w-full items-center gap-2 rounded-[6px] px-2.5 py-1.5 text-left text-[12px] font-[550] text-ink-faint transition-colors hover:bg-sub-300/70 hover:text-ink disabled:cursor-wait disabled:opacity-60"
          >
            <FolderPlus size={13} strokeWidth={1.8} className="flex-none" aria-hidden />
            {adding ? "Adding…" : "Add folder…"}
          </button>
          {notice && <p className="px-2.5 pb-1 text-[11px] text-ink-faint">{notice}</p>}
        </div>
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
        aria-label={`Working folder: ${label}`}
        onClick={() => (open ? close() : openMenu())}
        onKeyDown={onKeyDown}
        className={[
          "inline-flex h-8 max-w-[180px] items-center gap-1.5 rounded-[8px] px-2 text-[11px] font-[550] transition-colors hover:bg-sub-200 aria-expanded:bg-sub-200",
          chosen ? "text-ink-faint hover:text-ink" : "text-ink-faint hover:text-ink",
        ].join(" ")}
      >
        <Folder size={13} strokeWidth={1.8} className="flex-none" aria-hidden />
        <span className="min-w-0 truncate">{label}</span>
      </button>
      {menu}
    </>
  );
}
