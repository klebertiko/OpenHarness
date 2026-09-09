"use client";
import { HEALTH_INK, type Billing, type Capability, type Health, type Residence } from "./catalog";
import type { Probe } from "./providerStore";

/**
 * The five marks this workstream adds to the shell's vocabulary. Each one
 * carries information; none of them is a decoration.
 */

/* ── Monogram ─────────────────────────────────────────────────────────────────
   Vendor identity as a two-letter mono tile, in grey.

   Deliberately not a logo and deliberately not a brand colour. Five vendors'
   brand hues next to each other would turn the wallet into a rainbow and would
   collide head-on with this app's rule that chroma means *state*. A tile that
   holds its shape lets the one coloured element in the row — the state rule —
   stay the thing your eye lands on. */
export function Monogram({
  text,
  live,
  size = 22,
}: {
  text: string;
  live?: boolean;
  size?: number;
}) {
  return (
    <span
      aria-hidden
      className="grid flex-none place-items-center rounded-control border bg-sub-200"
      style={{
        width: size,
        height: size,
        borderColor: live ? "var(--signal-deep)" : "var(--line)",
        color: live ? "var(--ink-dim)" : "var(--ink-mute)",
      }}
    >
      <span
        className="font-mono font-medium leading-none"
        style={{ fontSize: Math.round(size * 0.42), letterSpacing: "0.04em" }}
      >
        {text}
      </span>
    </span>
  );
}

/* ── Residence mark ───────────────────────────────────────────────────────────
   Solid square = the tokens are computed on this machine.
   Hollow square = they leave it.

   Filled versus outlined is the fastest binary the eye can resolve, it needs no
   colour, and it survives being 6px wide next to a 12px label. */
export function ResidenceMark({ residence }: { residence: Residence }) {
  const local = residence === "local";
  return (
    <span
      aria-hidden
      className="flex-none rounded-[1px]"
      style={{
        width: 6,
        height: 6,
        background: local ? "var(--ink-dim)" : "transparent",
        boxShadow: local ? "none" : "inset 0 0 0 1px var(--ink-mute)",
      }}
    />
  );
}

/* ── Stamp ────────────────────────────────────────────────────────────────────
   A fixed-position fact in the dossier header. Kicker above, value below, ruled
   on the left. Three of them side by side read as a column each, so comparing
   two connections is a vertical scan rather than a paragraph. */
export function Stamp({
  kicker,
  value,
  mark,
  tone = "ink",
  note,
}: {
  kicker: string;
  value: string;
  mark?: React.ReactNode;
  tone?: "ink" | "warn" | "fault" | "signal";
  note?: string;
}) {
  const color =
    tone === "warn"
      ? "var(--warn)"
      : tone === "fault"
        ? "var(--fault)"
        : tone === "signal"
          ? "var(--signal)"
          : "var(--ink)";
  return (
    <div className="min-w-0 flex-1 border-l border-line-soft pl-2.5">
      <div className="t-label text-ink-faint">{kicker}</div>
      <div className="mt-1 flex items-center gap-1.5">
        {mark}
        <span className="t-title truncate" style={{ color }}>
          {value}
        </span>
      </div>
      {note && <div className="t-body mt-0.5 truncate text-ink-mute">{note}</div>}
    </div>
  );
}

/* ── Probe trace ──────────────────────────────────────────────────────────────
   Twelve reachability checks as 2px bars, oldest to newest, height on a square
   root scale so a 300ms cloud hop and a 4ms loopback both stay readable in the
   same 12px band. A gap in the trace is a failed probe drawn as a floor tick in
   fault — you can see *when* a provider started refusing, not just that it is
   refusing now. This is the difference between "OpenAI is broken" and "OpenAI
   has been broken since Tuesday". */
export function ProbeTrace({
  probes,
  health,
  height = 13,
}: {
  probes: Probe[];
  health: Health;
  height?: number;
}) {
  if (!probes.length) {
    return (
      <span
        aria-hidden
        className="flex-none border-b border-dashed border-ink-faint"
        style={{ width: 35, height }}
      />
    );
  }
  const max = Math.max(...probes.map((p) => p.ms), 1);
  return (
    <span
      aria-hidden
      className="flex flex-none items-end gap-px"
      style={{ height }}
      title={`last ${probes.length} probes`}
    >
      {probes.map((p, i) => {
        const last = i === probes.length - 1;
        const h = p.ok ? Math.max(2, Math.round(Math.sqrt(p.ms / max) * height)) : 2;
        return (
          <span
            key={i}
            className="w-[2px] rounded-[0.5px]"
            style={{
              height: h,
              background: !p.ok
                ? "var(--fault)"
                : last
                  ? HEALTH_INK[health]
                  : "var(--ink-faint)",
            }}
          />
        );
      })}
    </span>
  );
}

/* ── State rule ───────────────────────────────────────────────────────────────
   The 2px vertical rule that opens every connection row. The only coloured
   element in the ledger, and the shell's existing `.oh-tick` grammar. */
export function StateRule({ health, tall }: { health: Health; tall?: boolean }) {
  return (
    <span
      aria-hidden
      className="flex-none rounded-[1px]"
      style={{ width: 2, height: tall ? 26 : 18, background: HEALTH_INK[health] }}
    />
  );
}

/* ── Chip ─────────────────────────────────────────────────────────────────────
   Squared, hairline, mono. Not a pill — pills are for consumer web, and this
   app's radius scale tops out at 5px. */
export function Chip({
  children,
  tone = "dim",
  onClick,
  title,
  active,
}: {
  children: React.ReactNode;
  tone?: "dim" | "signal" | "warn" | "fault";
  onClick?: () => void;
  title?: string;
  active?: boolean;
}) {
  const color =
    tone === "signal"
      ? "var(--signal)"
      : tone === "warn"
        ? "var(--warn)"
        : tone === "fault"
          ? "var(--fault)"
          : "var(--ink-dim)";
  const Tag = onClick ? "button" : "span";
  return (
    <Tag
      type={onClick ? "button" : undefined}
      onClick={onClick}
      title={title}
      className={[
        "t-meta inline-flex h-[19px] items-center gap-1.5 rounded-control border px-1.5 transition-colors",
        active ? "border-signal-deep bg-sub-300" : "border-line bg-sub-200",
        onClick ? "hover:border-ink-faint hover:bg-sub-300" : "",
      ].join(" ")}
      style={{ color }}
    >
      {children}
    </Tag>
  );
}

/* ── Label tables used by more than one component ─────────────────────────── */

export const CAP_WORD: Record<Capability, string> = {
  chat: "completion",
  agent: "delegation",
  embed: "embedding",
};

export const BILL_WORD: Record<Billing, string> = {
  subscription: "seat",
  credits: "credits",
  metered: "per token",
  none: "free",
};
