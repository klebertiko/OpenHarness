"use client";
import { useEffect, useState } from "react";
import { ChevronRight } from "lucide-react";
import { ListGroup, ListRow, StatusDot, type Tone } from "@/components/shell/ListRow";
import { type ConnectionUsage } from "@/lib/usageApi";
import type { Health, Residence } from "./catalog";
import { useProviderStore, type Connection } from "./providerStore";
import { usageCostLabel, useUsageStore } from "./usageStore";

/**
 * Every connection this install holds, grouped by residence.
 *
 * Residence is the top-level grouping rather than vendor because it is the
 * question with a consequence: "did that prompt leave this machine?" changes
 * what you are allowed to put in it. The two Ollama rows land in different
 * groups for exactly that reason.
 *
 * Credentials never appear here — only labels and health.
 * ADR 0001 § Consequences ¶6 (`docs/adr/0001-desktop-packaging.md`):
 * "Provider credentials must never reach the renderer." Refs live in
 * `secrets.ts` / the host vault; this panel is labels-only by construction.
 * Endpoints, probes and billing live in the dossier, one click away.
 */

const GROUPS: { key: Residence; label: string }[] = [
  { key: "local", label: "On this machine" },
  { key: "cloud", label: "Cloud" },
];

/** Health as one plain sentence, and the one colour that goes with it. */
const STATUS: Record<Health, { text: string; tone: Tone }> = {
  live: { text: "Connected", tone: "ok" },
  setup: { text: "Needs setup", tone: "warn" },
  degraded: { text: "Unstable connection", tone: "warn" },
  fault: { text: "Can't connect", tone: "fault" },
  probing: { text: "Checking…", tone: "idle" },
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
  const status = STATUS[c.health];
  const costLabel = rowCostLabel(c, usage);
  return (
    <ListRow
      title={c.label}
      subtitle={status.text}
      leading={<StatusDot tone={status.tone} pulse={c.health === "probing"} />}
      selected={selected}
      onSelect={onSelect}
      trailing={
        <span className="flex items-center gap-1.5">
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
        const rows = connections.filter((c) => c.residence === g.key);
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
