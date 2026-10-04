"use client";
import { useEffect, useState } from "react";
import { ChevronRight } from "lucide-react";
import { rowStatus, rowTone, type ChatProviderTone } from "@/components/agent/chatProvider";
import { ListGroup, ListRow, StatusDot, type Tone } from "@/components/shell/ListRow";
import { type ConnectionUsage } from "@/lib/usageApi";
import { ResidenceMark } from "./atoms";
import { useProviderStore, type Connection } from "./providerStore";
import { usageCostLabel, useUsageStore } from "./usageStore";

/**
 * Every connection this install holds, grouped by whether it can answer a
 * run right now — "Ready" above "Needs setup" — the same split the chat
 * combo groups its own rows by (`ChatProviderPicker.tsx`), so a connection
 * never wears a different status word, or sits in a differently-named
 * bucket, depending which surface you're looking at it from.
 *
 * This used to group by residence instead (did the prompt leave this
 * machine?) on the reasoning that residence is the property with a
 * consequence. That's still true, so it survives here as the small filled
 * / hollow mark on each row (`ResidenceMark`) rather than disappearing —
 * readiness answers "what can I use right now", residence answers "what am
 * I allowed to put in it", and a list grouped by the first still needs the
 * second visible per row.
 *
 * Credentials never appear here — only labels and health.
 * ADR 0001 § Consequences ¶6 (`docs/adr/0001-desktop-packaging.md`):
 * "Provider credentials must never reach the renderer." Refs live in
 * `secrets.ts` / the host vault; this panel is labels-only by construction.
 * Endpoints, probes and billing live in the dossier, one click away.
 */

const GROUPS: { key: "ready" | "needsSetup"; label: string }[] = [
  { key: "ready", label: "Ready" },
  { key: "needsSetup", label: "Needs setup" },
];

/** Same six-way split the chat combo's dot uses (`ChatProviderPicker.tsx`'s
    `toneDotClass`), mapped onto this list's plainer four-tone vocabulary —
    this panel has never carried the "checking" vs "never probed" pulse
    distinction, and introducing it here would be a new promise this list
    doesn't otherwise keep. */
const TONE: Record<ChatProviderTone, Tone> = {
  verified: "ok",
  attention: "warn",
  checking: "idle",
  failing: "fault",
  unverified: "idle",
  unconfigured: "idle",
};

/** Cost badge text for one connection's row — undefined (render nothing)
    when it has never actually been used, a genuinely different state from
    "used, but free" or "used, but unpriced" (both of which formatCost
    already tells apart honestly). */
function rowCostLabel(c: Connection, usage: ConnectionUsage | undefined): string | undefined {
  if (!usage || usage.tokensTotal <= 0) return undefined;
  return usageCostLabel(usage);
}

function ProviderRow({
  c,
  usage,
  selected,
  onSelect,
}: {
  c: Connection;
  usage: ConnectionUsage | undefined;
  selected: boolean;
  onSelect: () => void;
}) {
  const costLabel = rowCostLabel(c, usage);
  return (
    <ListRow
      title={c.label}
      subtitle={rowStatus(c)}
      leading={<StatusDot tone={TONE[rowTone(c)]} pulse={c.health === "probing"} />}
      selected={selected}
      onSelect={onSelect}
      trailing={
        <span className="flex items-center gap-2">
          <ResidenceMark residence={c.residence} />
          {costLabel && <span className="t-meta text-ink-faint">{costLabel}</span>}
          <ChevronRight
            size={14}
            strokeWidth={1.8}
            className="text-ink-faint opacity-0 transition-opacity group-hover:opacity-100"
          />
        </span>
      }
    />
  );
}

const BUDGET_TONE_CLASS: Record<Tone, string> = {
  ok: "text-signal",
  warn: "text-warn",
  fault: "text-fault",
  idle: "text-ink-faint",
};

/** Global spend + budget — one line always visible, an inline editor one
    click away. Lives here (not the Dossier) because it is the one thing on
    this screen that is never about a single connection. */
function BudgetStrip() {
  const summary = useUsageStore((s) => s.summary);
  const loading = useUsageStore((s) => s.loading);
  const error = useUsageStore((s) => s.error);
  const setBudget = useUsageStore((s) => s.setBudget);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  const budget = summary?.budget;
  const tone: Tone =
    !budget || budget.state === "unset" ? "idle" : budget.state === "ok" ? "ok" : budget.state === "warning" ? "warn" : "fault";

  const startEdit = () => {
    setDraft(budget?.limitUsd != null ? String(budget.limitUsd) : "");
    setEditing(true);
  };

  const save = async () => {
    const trimmed = draft.trim();
    if (trimmed === "") {
      await setBudget(null);
      setEditing(false);
      return;
    }
    const n = Number(trimmed);
    if (!Number.isFinite(n) || n < 0) return; // leave the editor open on a bad value
    await setBudget(n);
    setEditing(false);
  };

  return (
    <div className="mx-1.5 mt-2 rounded-[8px] border border-line-soft bg-sub-100 px-2.5 py-2">
      <div className="flex items-center justify-between gap-2">
        <span className="t-label text-ink-faint">spend</span>
        <span className={`t-meta flex items-center gap-1.5 ${BUDGET_TONE_CLASS[tone]}`}>
          <StatusDot tone={tone} />
          {summary ? usageCostLabel(summary) : "—"}
        </span>
      </div>
      {loading && <p role="status" className="t-body text-ink-dim">Loading usage...</p>}
      {error && <p role="alert" className="t-body text-warn">Usage may be stale: {error}</p>}
      {editing ? (
        <div className="mt-1.5 flex items-center gap-1.5">
          <input
            autoFocus
            aria-label="Global budget in USD"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void save();
              if (e.key === "Escape") setEditing(false);
            }}
            placeholder="no limit"
            className="t-meta h-[22px] w-full min-w-0 rounded-control border border-line-soft bg-sub-200 px-1.5 text-ink outline-none focus:border-signal-deep"
          />
          <button type="button" onClick={() => void save()} className="t-meta flex-none text-ink-dim hover:text-ink">
            save
          </button>
          <button
            type="button"
            onClick={() => setEditing(false)}
            className="t-meta flex-none text-ink-faint hover:text-ink-dim"
          >
            cancel
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={startEdit}
          className="t-meta mt-0.5 block truncate text-left text-ink-faint hover:text-ink-dim"
        >
          {budget?.limitUsd != null
            ? `of $${budget.limitUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} budget`
            : "no budget set — click to set one"}
        </button>
      )}
    </div>
  );
}

export function ProvidersList() {
  const { connections, selectedId, select } = useProviderStore();
  const hydrateUsage = useUsageStore((s) => s.hydrate);
  const usageByConnection = useUsageStore((s) => s.summary?.byConnection);

  useEffect(() => {
    void hydrateUsage();
  }, [hydrateUsage]);

  const usageFor = (id: string) => usageByConnection?.find((u) => u.connectionId === id);

  return (
    <div className="h-full min-h-0 overflow-y-auto pb-3">
      <BudgetStrip />
      {GROUPS.map((g) => {
        const ready = (c: Connection) => c.enabled && c.health !== "fault";
        const rows = connections.filter((c) => (g.key === "ready" ? ready(c) : !ready(c)));
        if (!rows.length) return null;
        return (
          <ListGroup key={g.key} label={g.label}>
            {rows.map((c) => (
              <ProviderRow
                key={c.id}
                c={c}
                usage={usageFor(c.id)}
                selected={c.id === selectedId}
                onSelect={() => select(c.id)}
              />
            ))}
          </ListGroup>
        );
      })}
    </div>
  );
}
