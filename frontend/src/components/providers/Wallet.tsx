"use client";
import { HEALTH_INK, HEALTH_LABEL, type Residence } from "./catalog";
import { Monogram, ProbeTrace, ResidenceMark, StateRule } from "./atoms";
import { specOf, useProviderStore, type Connection } from "./providerStore";

/**
 * The wallet — every connection this install holds, grouped by residence.
 *
 * Residence is the top-level grouping rather than vendor because it is the
 * question with a consequence. "Which vendors do I have?" is trivia. "Did that
 * prompt leave this machine?" changes what you are allowed to put in it. The
 * two Ollama rows land in different groups for exactly that reason: same
 * vendor, same protocol, opposite answer.
 *
 * Credentials never appear here — only labels, health, and endpoints.
 * ADR 0001 § Consequences ¶6 (`docs/adr/0001-desktop-packaging.md`):
 * "Provider credentials must never reach the renderer." Refs live in
 * `secrets.ts` / the host vault; this panel is labels-only by construction.
 */

const GROUPS: { key: Residence; label: string; note: string }[] = [
  { key: "local", label: "On this machine", note: "no egress · no billing" },
  { key: "cloud", label: "Vendor cloud", note: "leaves the device" },
];

function Row({ c, selected, onSelect }: { c: Connection; selected: boolean; onSelect: () => void }) {
  const spec = specOf(c);
  const live = c.health === "live";
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={selected}
      className={[
        "oh-focus-inner group flex w-full items-center gap-2 px-2 py-1.5 text-left transition-colors",
        selected ? "bg-sub-300" : "hover:bg-sub-200",
      ].join(" ")}
    >
      <StateRule health={c.health} tall />
      <Monogram text={spec.monogram} live={live} size={20} />

      <span className="min-w-0 flex-1">
        <span
          className={[
            "t-title block truncate",
            selected ? "text-ink" : live ? "text-ink-dim" : "text-ink-mute",
          ].join(" ")}
        >
          {c.label}
        </span>
        <span className="t-meta mt-px flex items-center gap-1 truncate text-ink-faint">
          {c.health === "live" ? (
            c.endpoint.replace(/^https?:\/\//, "")
          ) : (
            <span style={{ color: HEALTH_INK[c.health] }}>{HEALTH_LABEL[c.health]}</span>
          )}
        </span>
      </span>

      <ProbeTrace probes={c.probes} health={c.health} height={12} />
    </button>
  );
}

export function Wallet() {
  const { connections, selectedId, select } = useProviderStore();

  const live = connections.filter((c) => c.health === "live").length;
  const bad = connections.filter((c) => c.health === "fault").length;
  const attention = connections.filter(
    (c) => c.health === "setup" || c.health === "degraded"
  ).length;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Tally. A wallet's first job is to tell you what needs you today. */}
      <div className="flex flex-none items-center gap-2.5 border-b border-line-soft px-2.5 py-2">
        <Tally n={live} word="live" ink="var(--signal)" />
        {attention > 0 && <Tally n={attention} word="waiting" ink="var(--warn)" />}
        {bad > 0 && <Tally n={bad} word="failing" ink="var(--fault)" />}
        <span className="flex-1" />
        <span className="t-meta text-ink-faint">{connections.length}</span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pb-3">
        {GROUPS.map((g) => {
          const rows = connections.filter((c) => c.residence === g.key);
          if (!rows.length) return null;
          return (
            <section key={g.key}>
              <header className="flex items-baseline gap-1.5 px-2.5 pb-1 pt-3">
                <ResidenceMark residence={g.key} />
                <h3 className="t-label text-ink-mute">{g.label}</h3>
                <span className="t-body truncate text-ink-faint">{g.note}</span>
              </header>
              {rows.map((c) => (
                <Row
                  key={c.id}
                  c={c}
                  selected={c.id === selectedId}
                  onSelect={() => select(c.id)}
                />
              ))}
            </section>
          );
        })}
      </div>
    </div>
  );
}

function Tally({ n, word, ink }: { n: number; word: string; ink: string }) {
  return (
    <span className="flex items-baseline gap-1">
      <span className="t-meta" style={{ color: ink, fontSize: 12 }}>
        {n}
      </span>
      <span className="t-body text-ink-faint">{word}</span>
    </span>
  );
}
