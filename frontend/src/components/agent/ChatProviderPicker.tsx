"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import {
  chatProviderOptions,
  pickChatProvider,
  providerReadiness,
  rowStatus,
  type ChatProviderTone,
} from "@/components/agent/chatProvider";
import { formatRelativeTime } from "@/lib/time";
import { prefixMatches } from "@/components/providers/secrets";
import { specOf, useProviderStore } from "@/components/providers/providerStore";
import { ModelPicker } from "@/components/providers/ModelPicker";
import { ComboAction, Combobox, type ComboOption } from "@/components/ui/Combobox";
import { useChatProviderStore } from "@/store/chatProviderStore";
import { useChatSetupRequestStore } from "@/store/chatSetupStore";

/** Dropdown-row dot per tone. A distinct pulsing "checking" state, and a
 * hollow ring for "unconfigured" — never the same filled dot as "failing",
 * so a credential that was tried and rejected never looks like a connection
 * nobody has configured yet.
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

/** One compact fix-it panel, scoped to a single not-ready connection: a
 * password field when a key is missing, a model picker when only the model is
 * missing, a single switch for anything else (a CLI session or no credential).
 * Mounted only while this row is expanded, so it reads live store state —
 * health flips from `probing` to `live` or `fault` while it stays open, and a
 * connection that just got its key moves on to "choose a model" in place.
 * design.md § Provider stance: fix it in place, state the real outcome.
 */
function InlineSetup({ id, onOpenProviders }: { id: string; onOpenProviders: () => void }) {
  const connection = useProviderStore((s) => s.connections.find((c) => c.id === id));
  const attachSecret = useProviderStore((s) => s.attachSecret);
  const toggleEnabled = useProviderStore((s) => s.toggleEnabled);
  const probe = useProviderStore((s) => s.probe);
  const setDefaultModel = useProviderStore((s) => s.setDefaultModel);

  const wrap = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [modelSave, setModelSave] = useState<"idle" | "saving" | "saved" | "failed">("idle");
  const [len, setLen] = useState(0);
  const [prefixOk, setPrefixOk] = useState(true);

  useEffect(() => {
    wrap.current?.querySelector<HTMLElement>("input, button")?.focus();
    // Only on mount — remounted fresh (keyed) each time a different row expands.
  }, []);

  if (!connection) return null;
  const spec = specOf(connection);
  const readiness = providerReadiness(connection);
  const probing = connection.health === "probing";
  const ready = readiness.ready;
  const failed = connection.health === "fault";
  // An enabled connection that only lacks a model gets the model picker;
  // anything else keyed (no key yet, or a key that failed) gets the paste field.
  const choosingModel = readiness.missing === "model";
  const keyed = !choosingModel && spec.credential.kind === "api-key";

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

  const saveModel = async (model: string) => {
    setModelSave("saving");
    setModelSave((await setDefaultModel(id, model)) ? "saved" : "failed");
  };

  const expected = spec.credential.prefix;

  return (
    <div ref={wrap} className="mx-1 mb-1 mt-1 rounded-control bg-sub-200 px-2.5 py-2.5">
      {choosingModel || modelSave !== "idle" ? (
        <>
          <p className="mb-1 text-[11px] font-[550] text-ink-faint">Choose a model for {connection.label}</p>
          <ModelPicker
            connection={connection}
            value={connection.defaultModel}
            onChange={(m) => void saveModel(m)}
            label={`${connection.label} model`}
          />
          {modelSave === "saving" && <p role="status" className="mt-1.5 text-[11px] text-ink-dim">Saving…</p>}
          {modelSave === "failed" && (
            <p role="alert" className="mt-1.5 text-[11px] text-fault">
              Couldn&apos;t save the model. Check the app is running and try again.
            </p>
          )}
        </>
      ) : keyed ? (
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
          type="button"
          onClick={() => void runKeyless()}
          disabled={busy || probing}
          className="h-7 w-full rounded-control bg-signal text-[12px] font-[550] text-signal-ink transition-colors hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy || probing ? "Checking…" : connection.enabled ? "Test again" : `Turn on ${connection.label}`}
        </button>
      )}

      {saveError && (
        <p role="alert" className="mt-1.5 text-[11px] text-fault">
          Couldn&apos;t save the key. Check the app is running and try again.
        </p>
      )}
      {probing && <p role="status" className="mt-1.5 text-[11px] text-ink-dim">Checking connection…</p>}
      {!probing && ready && (
        <p role="status" className="mt-1.5 text-[11px] text-signal">
          {connection.defaultModel ? `Ready · ${connection.defaultModel}` : "Verified."}
        </p>
      )}
      {!probing && failed && <p className="mt-1.5 text-[11px] text-fault">{connection.detail}</p>}

      <button
        type="button"
        onClick={onOpenProviders}
        className="mt-1.5 text-[11px] text-ink-faint underline-offset-2 hover:text-ink-dim hover:underline"
      >
        Open in Providers
      </button>
    </div>
  );
}

/** Option id for "Auto" — no connection id is empty. */
const AUTO_ID = "";

/* Hallmark · component: provider picker · design-system: design.md
 * Built on the shared Combobox. Any row is choosable; a not-ready pick opens
 * its fix-it panel under the list instead of closing (design.md § Provider
 * stance). The panel sits outside the listbox, so the list stays a valid
 * listbox for assistive tech.
 * Pre-emit critique (providers-recovery audit): P5 H4 E4 S5 R4 V4 — one
 * picker pattern app-wide; E/R at 4 for the second density tier the panel adds.
 */
export function ChatProviderPicker({ onConnect }: { onConnect: () => void }) {
  const connections = useProviderStore((s) => s.connections);
  const selectConnection = useProviderStore((s) => s.select);
  const chosenId = useChatProviderStore((s) => s.chosenId);
  const setChosen = useChatProviderStore((s) => s.setChosen);
  const setupRequestToken = useChatSetupRequestStore((s) => s.token);
  const setupRequestId = useChatSetupRequestStore((s) => s.id);
  const provider = useMemo(() => pickChatProvider(connections, chosenId), [connections, chosenId]);

  const rows = useMemo(() => {
    const list = chatProviderOptions(connections);
    if (chosenId && !list.some((r) => r.id === chosenId)) {
      list.push({ id: chosenId, label: "Unavailable provider", detail: "Connection no longer available", ready: false, tone: "unconfigured" });
    }
    const [auto, ...rest] = list;
    // Every ready row before every row that needs setup — "what can I use
    // right now" at a glance. Auto stays first.
    return [auto, ...rest.filter((r) => r.ready), ...rest.filter((r) => !r.ready)];
  }, [connections, chosenId]);
  const readyCount = rows.filter((r) => r.ready).length;
  const mixed = readyCount > 0 && readyCount < rows.length;
  const fixable = (id: string | null) => Boolean(id && connections.some((c) => c.id === id));

  const connection = connections.find((c) => c.id === (chosenId ?? provider?.id));
  const status = connection ? rowStatus(connection) : "Unavailable";
  const label = chosenId
    ? connection?.label ?? "Unavailable provider"
    : provider ? "Auto · " + provider.label : "Auto · No available provider";
  const verified = Boolean(provider && connection?.health === "live");
  const dotClass = verified
    ? "bg-signal"
    : status === "Unavailable" || status === "Needs attention" || status === "No model chosen"
      ? "bg-warn"
      : "bg-ink-faint";
  // A probe in flight must not look identical to "never verified".
  const probing = status === "Checking connection";
  // Real evidence only: an unprobed connection never grows a timestamp.
  const lastChecked = connection?.lastProbe ? "checked " + formatRelativeTime(connection.lastProbe) : null;
  const model = provider && connection?.defaultModel ? connection.defaultModel : null;
  // Auto that resolves to nothing has no status of its own to add.
  const unresolvedAuto = !chosenId && !provider;
  const statusLine = unresolvedAuto
    ? label
    : label + " · " + status + (model ? " · " + model : "") + (lastChecked ? " · " + lastChecked : "");
  const chipText = unresolvedAuto ? label : label + " · " + status;

  const [open, setOpen] = useState(false);
  const [setupId, setSetupId] = useState<string | null>(null);

  const options: ComboOption[] = rows.map((r) => ({
    id: r.id ?? AUTO_ID,
    label: r.label,
    detail: r.detail,
    group: !mixed || (r.id === null && !r.ready) ? undefined : r.ready ? "Ready" : "Needs setup",
    leading: <span className={"h-1.5 w-1.5 flex-none rounded-full " + toneDotClass(r.tone)} aria-hidden />,
    trailing:
      !r.ready && fixable(r.id) ? (
        <span className="flex-none text-[11px] font-[550] text-signal">{setupId === r.id ? "Hide" : "Set up"}</span>
      ) : undefined,
  }));

  const rowFor = (id: string) => rows.find((r) => (r.id ?? AUTO_ID) === id);

  /* Choosing always sets the chat default — ready or not, never a dead click.
     A not-ready row with a real connection behind it opens its fix-it panel
     (choosing it again collapses the panel); anything else closes. */
  const choose = (id: string) => {
    const row = rowFor(id);
    if (!row) return;
    setChosen(row.id);
    if (row.ready || !fixable(row.id)) {
      setSetupId(null);
      return;
    }
    setSetupId((current) => (current === row.id ? null : row.id));
  };
  const keepOpen = (id: string) => {
    const row = rowFor(id);
    return Boolean(row && !row.ready && fixable(row.id));
  };

  // An external control (the composer's "what's missing" action) asked this
  // combo to open and, when it names a connection, to expand that row's
  // fix-it panel. `token` fires even on a repeat request for the same id.
  useEffect(() => {
    if (setupRequestToken === 0) return;
    setOpen(true);
    setSetupId(setupRequestId && fixable(setupRequestId) ? setupRequestId : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setupRequestToken]);

  return (
    <Combobox
      label="Chat provider"
      triggerLabel={"Chat provider: " + statusLine}
      title={statusLine}
      value={chosenId ?? AUTO_ID}
      options={options}
      onChange={choose}
      keepOpen={keepOpen}
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setSetupId(null);
      }}
      onEscape={({ focusList }) => {
        if (!setupId) return false;
        setSetupId(null);
        focusList();
        return true;
      }}
      header="Chat default. Agents with a pinned connection use their own provider."
      triggerClassName="h-8 max-w-[260px] px-2 text-[11px] font-[550] text-ink-dim"
      trigger={
        <>
          <span className={"h-1.5 w-1.5 flex-none rounded-full " + dotClass + (probing ? " animate-pulse" : "")} aria-hidden />
          <span className="min-w-0 truncate">{chipText}</span>
        </>
      }
      panel={
        setupId && fixable(setupId)
          ? ({ close }) => (
              <InlineSetup
                key={setupId}
                id={setupId}
                onOpenProviders={() => {
                  selectConnection(setupId);
                  close();
                  onConnect();
                }}
              />
            )
          : undefined
      }
      footer={({ close }) => (
        <ComboAction
          onClick={() => {
            if (chosenId) selectConnection(chosenId);
            close();
            onConnect();
          }}
        >
          <span className="truncate">Manage providers</span>
        </ComboAction>
      )}
    />
  );
}
