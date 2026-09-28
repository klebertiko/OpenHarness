"use client";
import { useEffect, useId, useMemo, useRef, useState, type RefObject } from "react";
import { chatCommands, splitArgv, type ChatCommand, type ChatToolsInput, type ToolPreset } from "./chatCommands";
interface Props {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  skills?: unknown;
  live: boolean;
  /** Workspace tools (contract v1.1). Absent → menu is Commands & bundled Skills only. */
  tools?: ChatToolsInput;
  /** A Tool was chosen: the parent starts a `/execute/direct` run with this preset. */
  onPreset?: (preset: ToolPreset) => void;
}
/** `/exec npm test` → preset, or a warning when the text contains shell syntax. */
export function presetFromSlashText(value: string): { preset: ToolPreset } | { warning: string } | null {
  const m = /^\/(exec|read)\s+([\s\S]+)$/.exec(value.trim());
  if (!m) return null;
  if (m[1] === "read") return { preset: { name: "read", path: m[2].trim() } };
  const { argv, shellSyntax } = splitArgv(m[2]);
  if (!argv.length) return null;
  if (shellSyntax.length) return { warning: `Sem shell do outro lado: ${shellSyntax.join(" ")} seria passado literalmente. Rode um programa por vez.` };
  return { preset: { name: "exec", argv } };
}
export function ChatComposer({ value, onChange, onSend, inputRef, skills, live, tools, onPreset }: Props) {
  const id = useId();
  const listRef = useRef<HTMLDivElement>(null);
  const [cursor, setCursor] = useState(0);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [loading, setLoading] = useState<string | null>(null);
  const query = /^\/([^\s/]*)$/.exec(value)?.[1] ?? null;
  const commands = useMemo(() => chatCommands(skills, tools), [skills, tools]);
  const options = useMemo(() => commands.filter(command =>
    (command.name + " " + command.description).toLowerCase().includes((query ?? "").toLowerCase())
  ), [commands, query]);
  const open = query !== null && dismissed !== value;
  const selected = Math.min(cursor, Math.max(0, options.length - 1));
  const optionId = (index: number) => id + "-command-" + index;
  const noWorkspace = tools !== undefined && !tools.workspace;
  const slashPreset = useMemo(() => presetFromSlashText(value), [value]);
  useEffect(() => {
    if (open) listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }, [open, selected, query]);
  const choose = (command: ChatCommand) => {
    if (live) return;
    setDismissed(null);
    setCursor(0);
    if (command.kind === "Tool") {
      if (command.takesArgs) { onChange("/" + command.name + " "); inputRef.current?.focus(); return; }
      onChange("");
      if (command.preset) onPreset?.(command.preset);
      inputRef.current?.focus();
      return;
    }
    if (command.loadDraft) {
      onChange("");
      setLoading(command.id);
      void command.loadDraft().then(text => onChange(text)).finally(() => setLoading(null));
      inputRef.current?.focus();
      return;
    }
    onChange(command.draft ?? "");
    command.run?.();
    inputRef.current?.focus();
  };
  const submit = () => {
    if (live) return;
    if (slashPreset && "preset" in slashPreset) { onPreset?.(slashPreset.preset); onChange(""); return; }
    if (slashPreset && "warning" in slashPreset) return;
    onSend();
  };
  return <div className="relative min-w-0">
    {open && <div className="oh-float absolute bottom-[calc(100%+0.5rem)] left-0 right-0 z-40 overflow-hidden rounded-panel border border-line bg-sub-100 shadow-lg">
      <div className="flex items-center justify-between gap-2 border-b border-line-soft px-3 py-2 text-[11px] text-ink-faint">
        <span>{tools?.workspace ? `Commands, skills & tools · ${tools.workspace.name}` : "Commands & skills"}</span><span>↑↓ select · Enter · Esc</span>
      </div>
      {live && <p role="status" className="px-3 py-2 text-[12px] text-warn">Stop or finish the run to use commands.</p>}
      {noWorkspace && !live && <p role="note" className="px-3 py-2 text-[12px] text-ink-mute">Selecione uma pasta para usar ferramentas</p>}
      <div ref={listRef} id={id + "-commands"} role="listbox" aria-label="Commands and skills" className="max-h-[min(320px,45vh)] overflow-y-auto p-1">
        {options.map((command, index) => <button key={command.id} id={optionId(index)} type="button" role="option" tabIndex={-1}
          aria-selected={index === selected} aria-disabled={live}
          onMouseDown={event => event.preventDefault()} onMouseMove={() => setCursor(index)} onClick={() => choose(command)}
          className={"flex w-full items-center gap-3 rounded-control px-3 py-2 text-left outline-none " + (index === selected ? "bg-sub-300" : "hover:bg-sub-200") + (live ? " opacity-50" : "")}>
          <span className="min-w-0 flex-1"><span className="block truncate text-[13px] font-medium text-ink">/{command.name}</span>
            <span className="block text-[11px] leading-4 text-ink-mute">{command.description}</span></span>
          {command.hint && <span className={"flex-none rounded-control px-1.5 py-0.5 text-[10px] " + (command.kind === "Tool" ? "bg-signal/15 text-signal" : "bg-sub-300 text-ink-mute")}>{command.hint}</span>}
          <span className="flex-none text-[10px] text-ink-faint">{command.kind}</span>
        </button>)}
      </div>
      {options.length === 0 && <p role="status" className="px-4 py-3 text-[12px] text-ink-mute">No matching commands. Esc keeps your text.</p>}
    </div>}
    {slashPreset && "warning" in slashPreset && <p role="alert" className="px-4 pt-2 text-[12px] text-warn">{slashPreset.warning}</p>}
    {loading && <p role="status" className="px-4 pt-2 text-[12px] text-ink-mute">Lendo a skill do workspace…</p>}
    <textarea ref={inputRef} value={value} rows={2} aria-label="Message OpenHarness" disabled={live}
      aria-autocomplete="list" aria-haspopup="listbox" aria-controls={open ? id + "-commands" : undefined}
      aria-activedescendant={open && options.length ? optionId(selected) : undefined}
      onChange={event => { onChange(event.target.value); setCursor(0); setDismissed(null); }}
      onBlur={() => setDismissed(value)}
      onKeyDown={event => {
        if (event.nativeEvent.isComposing || event.keyCode === 229) return;
        if (open) {
          if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setDismissed(value); return; }
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setCursor(options.length ? (selected + (event.key === "ArrowDown" ? 1 : options.length - 1)) % options.length : 0);
            return;
          }
          if (event.key === "Enter" || (event.key === "Tab" && !event.shiftKey)) {
            event.preventDefault(); if (options[selected]) choose(options[selected]); return;
          }
        } else if (query !== null && event.key === "ArrowDown") {
          event.preventDefault(); setDismissed(null); return;
        }
        if ((event.metaKey || event.ctrlKey) && event.key === "Enter" && !live) { event.preventDefault(); submit(); }
      }}
      placeholder={live ? "Waiting on this run — click Stop to send something new" : tools?.workspace ? `Ask OpenHarness… Type / for commands, skills and tools in ${tools.workspace.name}` : "Ask OpenHarness… Type / for commands and skills"}
      className="block min-h-[64px] w-full resize-none bg-transparent px-4 pt-3.5 text-[15px] leading-6 text-ink outline-none placeholder:text-ink-faint disabled:cursor-not-allowed disabled:opacity-60" />
  </div>;
}
