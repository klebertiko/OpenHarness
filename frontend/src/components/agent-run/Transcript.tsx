"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { ROLE_ICON, ROLE_VAR } from "@/lib/roles";
import { pickChatProvider } from "@/components/agent/chatProvider";
import { useChatProviderStore } from "@/store/chatProviderStore";
import { useProviderStore, type Connection } from "@/components/providers/providerStore";
import css from "./agentRun.module.css";
import { clock, latency as fmtLatency, paragraphs, tokens as fmtTokens } from "./format";
import { Gate } from "./Gate";
import { ToolCard } from "./ToolCard";
import { useActiveRunStore } from "@/store/activeRunStore";
import { connectionLabel, isPinnedMismatch } from "./pinnedConnection";
import { rollupTotals } from "./rollup";
import type { Block, RunState, Segment, ToolCall } from "./types";

/* ── Marker ────────────────────────────────────────────────────────────────
   The glyph hanging off the spine. Shape carries state, colour carries role —
   so a run reads correctly in a screenshot, and would still read correctly to
   someone who cannot separate the nine role hues. */
function Marker({ segment }: { segment: Segment }) {
  const role = ROLE_VAR[segment.type] ?? "var(--ink-faint)";
  const s = segment.state;

  if (s === "gate") {
    return (
      <span
        className="relative z-10 block h-[9px] w-[9px] rotate-45 rounded-[1px] border"
        style={{ borderColor: "var(--warn)", background: "var(--sub-100)" }}
        aria-hidden
      />
    );
  }
  if (s === "error") {
    return (
      <span
        className="relative z-10 block h-[9px] w-[9px] rounded-[1px]"
        style={{ background: "var(--fault)" }}
        aria-hidden
      />
    );
  }
  if (s === "running") {
    return (
      <span
        className="relative z-10 block h-[9px] w-[9px] rounded-[1px] border-2"
        style={{ borderColor: role, background: "var(--sub-100)" }}
        aria-hidden
      />
    );
  }
  if (s === "done") {
    return (
      <span
        className="relative z-10 block h-[9px] w-[9px] rounded-[1px]"
        style={{ background: role }}
        aria-hidden
      />
    );
  }
  if (s === "skipped") {
    // A PASS/FAIL branch this run didn't take — deliberately distinct from
    // the hollow "pending" marker below it (same shape would read as "still
    // waiting", not "this path wasn't selected").
    return (
      <span
        className="relative z-10 flex h-[9px] w-[9px] items-center justify-center rounded-[1px] border border-dashed"
        style={{ borderColor: "var(--ink-faint)" }}
        aria-hidden
      />
    );
  }
  return (
    <span
      className="relative z-10 block h-[7px] w-[7px] rounded-[1px] border"
      style={{ borderColor: "var(--ink-faint)", background: "var(--sub-100)" }}
      aria-hidden
    />
  );
}

/* ── Tool call ─────────────────────────────────────────────────────────────
   One line per call. Machine-written throughout, so mono throughout: the name
   at ink, the arguments dimmed behind it, the result and duration hanging off
   the right edge where they line up into a column you can scan. */
function ToolRow({ call, transcriptRunId }: { call: ToolCall; transcriptRunId: string | null }) {
  const activeRunId = useActiveRunStore((s) => s.runId);
  // SEC gate 2026-09-24 (P2-FE-1): a control decision only ever targets the
  // *live* run — this card must not offer one for a replayed historical run
  // (HistoricalRunDetail.tsx) just because some *other* run happens to be
  // live right now. `runId` reaching ToolCard is null (buttons disabled)
  // unless this Transcript's own run genuinely is the active one.
  const runId = transcriptRunId !== null && transcriptRunId === activeRunId ? activeRunId : null;
  const [open, setOpen] = useState(false);
  // The composer's currently-selected connection — what a read result is fed
  // back to, hence what the card must disclose for a remote provider.
  const connections = useProviderStore((s) => s.connections);
  const chosenProviderId = useChatProviderStore((s) => s.chosenId);
  const connection = useMemo(() => {
    const pickedId = pickChatProvider(connections, chosenProviderId)?.id ?? null;
    return connections.find((c) => c.id === pickedId) ?? null;
  }, [connections, chosenProviderId]);
  // Chat tools broker calls (approval gate, denial, simulation) get the full
  // card — the approval card is a security surface (threat-model T5), not a
  // one-line log entry.
  if (call.approval || call.denied || call.simulated || call.origin) {
    return <ToolCard call={call} runId={runId} connection={connection} />;
  }
  const pending = call.ok === undefined;
  const failed = call.ok === false;
  const long = (call.result?.length ?? 0) > 64 || call.args.length > 60;

  return (
    <div
      className="mt-1 flex min-w-0 items-center gap-2 rounded-control border border-line-soft bg-sub-200 py-[3px] pl-2 pr-2"
      style={failed ? { borderColor: "var(--fault)" } : undefined}
    >
      <span
        className="h-[10px] w-[2px] flex-none rounded-[1px]"
        style={{
          background: pending ? "var(--signal)" : failed ? "var(--fault)" : "var(--ink-faint)",
        }}
        aria-hidden
      />
      <span className="t-meta flex-none text-ink">{call.name}</span>
      <button
        type="button"
        disabled={!long}
        onClick={() => setOpen((v) => !v)}
        className={`t-meta min-w-0 flex-1 text-left text-ink-faint ${open ? "" : css.argEllipsis} ${
          long ? "hover:text-ink-mute" : "cursor-default"
        }`}
        title={long ? "Expand" : undefined}
      >
        {call.args}
      </button>

      {pending ? (
        <span className="t-meta flex-none" style={{ color: "var(--signal)" }}>
          running
        </span>
      ) : (
        <>
          <span
            className={`t-meta flex-none ${open ? "" : "max-w-[46%] truncate"}`}
            style={{ color: failed ? "var(--fault)" : "var(--ink-mute)" }}
          >
            {call.result}
          </span>
          <span className="t-meta flex-none text-ink-faint">
            {fmtLatency(call.durationMs ?? 0)}
          </span>
        </>
      )}
    </div>
  );
}

/* ── Reasoning ─────────────────────────────────────────────────────────────
   Kept, but kept quiet: a thin rule, muted ink, and collapsed to a single line
   once the node has finished. Reasoning matters while it is happening and is
   clutter afterwards. */
function Reasoning({ text, done }: { text: string; done: boolean }) {
  const [open, setOpen] = useState(false);
  const show = open || !done;
  return (
    <div className="mt-1.5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={!done}
        className="t-meta flex items-center gap-1.5 text-ink-faint disabled:cursor-default hover:text-ink-mute"
      >
        <span aria-hidden>{done ? (open ? "▾" : "▸") : "▾"}</span>
        {done ? "thought" : "thinking"}
      </button>
      {show && (
        <p
          className={`t-body mt-1 border-l pl-2.5 text-ink-mute ${css.prose}`}
          style={{ borderColor: "var(--line-soft)" }}
        >
          {text}
          {!done && <span className={css.caret} />}
        </p>
      )}
    </div>
  );
}

function BlockView({ block, streaming, runId }: { block: Block; streaming: boolean; runId: string | null }) {
  if (block.kind === "tool") return <ToolRow call={block.call} transcriptRunId={runId} />;
  if (block.kind === "reason") return <Reasoning text={block.text} done={!streaming} />;
  const paras = paragraphs(block.text);
  return (
    <div className="mt-1.5 space-y-2">
      {paras.map((p, i) => (
        <p key={i} className={`t-body text-ink ${css.prose}`}>
          {p}
          {streaming && i === paras.length - 1 && <span className={css.caret} />}
        </p>
      ))}
    </div>
  );
}

/* ── One node ─────────────────────────────────────────────────────────────── */
function SegmentView({
  segment,
  first,
  last,
  onResolve,
  runId,
}: {
  segment: Segment;
  first: boolean;
  last: boolean;
  onResolve: (decision: "approve" | "reject", note: string) => void;
  runId: string | null;
}) {
  const Icon = ROLE_ICON[segment.type] ?? ROLE_ICON.agent;
  const role = ROLE_VAR[segment.type] ?? "var(--ink-faint)";
  const running = segment.state === "running";
  const pending = segment.state === "pending" || segment.state === "skipped";
  const lastBlockIndex = segment.blocks.length - 1;

  return (
    <div className="grid grid-cols-[24px_minmax(0,1fr)]">
      <div
        className={`${css.gutter} ${first ? css.gutterFirst : ""} ${last ? css.gutterLast : ""}`}
      >
        <div className="flex h-[22px] items-center justify-center pl-[3px]">
          <Marker segment={segment} />
        </div>
      </div>

      <div className={`min-w-0 pb-3 ${pending ? "opacity-45" : ""}`}>
        {/* Node header — label left, identity centre-dim, cost right. */}
        <div className="flex h-[22px] min-w-0 items-center gap-2">
          <Icon size={12} strokeWidth={1.75} style={{ color: role }} className="flex-none" />
          <span className="t-title min-w-0 flex-none truncate text-ink">{segment.label}</span>
          <span className="t-meta min-w-0 flex-1 truncate text-ink-faint">
            {segment.intrinsic
              ? segment.type
              : `${segment.type} · ${segment.model || segment.adapter}`}
          </span>
          {segment.state === "done" && (
            <span className="t-meta flex-none text-ink-faint">
              {segment.latencyMs ? fmtLatency(segment.latencyMs) : null}
              {segment.tokens ? ` · ${fmtTokens(segment.tokens)} tok` : null}
            </span>
          )}
          {running && segment.phase && (
            <span className="t-meta flex-none" style={{ color: "var(--signal)" }}>
              {segment.phase}
              {segment.phaseDetail ? ` · ${segment.phaseDetail}` : ""}
            </span>
          )}
        </div>

        {segment.blocks.map((b, i) => (
          <BlockView key={i} block={b} streaming={running && i === lastBlockIndex} runId={runId} />
        ))}

        {/* An intrinsic node has no adapter and therefore no stream — its
            output is the whole of it, so it is shown rather than hidden. */}
        {segment.intrinsic && segment.type !== "hitl" && segment.output && (
          <p className={`t-body mt-1.5 text-ink-dim ${css.prose}`}>{segment.output}</p>
        )}

        {segment.gate && <Gate segment={segment} onResolve={onResolve} />}

        {segment.error && (
          <div
            className="mt-1.5 rounded-control border px-2 py-1.5"
            style={{ borderColor: "var(--fault)" }}
          >
            <span className="t-label" style={{ color: "var(--fault)" }}>
              fault
            </span>
            <p className={`t-body mt-0.5 text-ink-dim ${css.prose}`}>{segment.error}</p>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Rollup ────────────────────────────────────────────────────────────────
   Two ways of answering "what did this run cost": one number up top, then
   where it went underneath. Mirrors RunControls.tsx's own metric pattern
   (mono value + dim unit, reusing format.ts's formatters verbatim) rather
   than importing RunControls itself — that component also carries the
   Start/Stop/Step transport buttons, which belong to the composer bar
   (AgentStage.tsx), not a scrolling transcript log. */
function Metric({ value, unit }: { value: string; unit: string }) {
  return (
    <span className="t-meta flex items-baseline gap-1 px-2.5 first:pl-0">
      <span className="text-ink-dim">{value}</span>
      <span className="text-ink-faint">{unit}</span>
    </span>
  );
}

/** Distinct from the default rows — a node that ran on a connection other
    than the one the chat composer would use today. Amber like the rest of
    the panel's "notice this" vocabulary (gates, unreachable-node notices),
    not red like a fault: nothing went wrong, it is just worth knowing. */
function PinnedBadge({ label }: { label: string }) {
  return (
    <span
      className="t-meta inline-flex items-center gap-1 rounded-control border px-1.5 py-[1px] text-ink-dim"
      style={{ borderColor: "var(--warn)" }}
      title={`Ran on a pinned connection different from today's chat default: ${label}`}
    >
      <span className="h-[5px] w-[5px] flex-none rounded-[1px]" style={{ background: "var(--warn)" }} aria-hidden />
      pinned: {label}
    </span>
  );
}

function RunRollup({ run, elapsed }: { run: RunState; elapsed?: number }) {
  if (!run.startedAt) return null; // nothing has run yet — no honest total to show
  const totals = rollupTotals(run, elapsed);
  const measured = totals.source === "measured";
  return (
    <div className="mb-2 flex items-center divide-x divide-line-soft border-b border-line-soft pb-2">
      <Metric value={totals.elapsedMs != null ? clock(totals.elapsedMs) : "—"} unit="elapsed" />
      <Metric value={fmtTokens(totals.tokens)} unit="tok" />
      <Metric
        value={run.plan.length ? `${run.totals.nodesRun}/${run.plan.length}` : "—"}
        unit="nodes"
      />
      {/* Provenance, always on screen: are these numbers the backend's own
          harness_done total, or the client still summing node events and
          ticking its own clock? The rollup used to switch sources silently;
          now it says which one it is showing. */}
      <span
        className="t-meta ml-auto flex items-center gap-1.5 pl-2.5 text-ink-faint"
        title={
          measured
            ? "Confirmed by the backend: harness_done reported this total."
            : "Still counting locally: the backend has not confirmed this total yet."
        }
      >
        <span
          className={`h-[5px] w-[5px] flex-none rounded-full ${
            measured ? "bg-signal" : `bg-ink-faint${run.status === "running" ? " animate-pulse" : ""}`
          }`}
          aria-hidden
        />
        {totals.source}
      </span>
    </div>
  );
}

/** Per-node latency + tokens as a real table, not another scroll of
    one-liners — same numbers the chronological view already shows inline
    per segment, laid out so they can be scanned and compared instead of
    read one at a time. Chronological (plan) order, not re-sorted by cost:
    this is an attribution of the run's own append-only event log, not a
    leaderboard. */
function NodeBreakdown({
  segments,
  defaultConnectionId,
  connections,
}: {
  segments: Segment[];
  defaultConnectionId: string | null;
  connections: Connection[];
}) {
  if (!segments.length) return null;
  return (
    <table className="mb-2 w-full border-collapse">
      <caption className="sr-only">Per-node latency and token attribution for this run</caption>
      <thead>
        <tr className="t-label text-ink-faint">
          <th scope="col" className="px-1.5 pb-1 text-left font-[600]">
            node
          </th>
          <th scope="col" className="px-1.5 pb-1 text-right font-[600]">
            latency
          </th>
          <th scope="col" className="px-1.5 pb-1 text-right font-[600]">
            tokens
          </th>
        </tr>
      </thead>
      <tbody>
        {segments.map((s) => {
          const mismatch = isPinnedMismatch(s.connectionId, defaultConnectionId);
          return (
            <tr key={s.nodeId} className="border-t border-line-soft">
              <td className="px-1.5 py-1">
                <span className="t-title text-ink">{s.label}</span>
                {mismatch && (
                  <span className="ml-2 inline-block align-middle">
                    <PinnedBadge label={connectionLabel(connections, s.connectionId!)} />
                  </span>
                )}
              </td>
              <td className="px-1.5 py-1 text-right">
                <span className="t-meta text-ink-dim">{s.latencyMs != null ? fmtLatency(s.latencyMs) : "—"}</span>
              </td>
              <td className="px-1.5 py-1 text-right">
                <span className="t-meta text-ink-dim">{s.tokens != null ? fmtTokens(s.tokens) : "—"}</span>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/* ── The transcript ───────────────────────────────────────────────────────── */
export function Transcript({
  run,
  onResolve,
  elapsed,
}: {
  run: RunState;
  onResolve: (decision: "approve" | "reject", note: string) => void;
  /** Live-ticking ms from useRunStream — optional because a replayed
      historical run (HistoricalRunDetail.tsx) has no live clock at all and
      relies on `rollupElapsedMs` falling back to the backend-measured
      `totals.elapsedMs` instead. */
  elapsed?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  const connections = useProviderStore((s) => s.connections);
  const chosenProviderId = useChatProviderStore((s) => s.chosenId);
  const defaultConnectionId = useMemo(
    () => pickChatProvider(connections, chosenProviderId)?.id ?? null,
    [connections, chosenProviderId]
  );
  const attributed = useMemo(
    () => run.plan.filter((s) => s.state === "done" || s.state === "error"),
    [run.plan]
  );

  /* Follow the stream, but stop following the moment someone scrolls up — a
     transcript that yanks you back to the bottom while you are reading is a
     transcript you cannot read. */
  const onScroll = () => {
    const el = ref.current;
    if (!el) return;
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  };
  useEffect(() => {
    const el = ref.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  });

  const shown = run.plan.filter((s) => s.state !== "pending" || run.status === "idle");
  const visible = shown.length ? shown : run.plan;

  return (
    <div ref={ref} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto px-2.5 pt-2.5">
      {run.notices.map((n, i) => (
        <div
          key={i}
          className="mb-2 rounded-control border px-2 py-1.5"
          style={{ borderColor: "var(--warn)" }}
        >
          <span className="t-body" style={{ color: "var(--warn)" }}>
            {n}
          </span>
        </div>
      ))}

      <RunRollup run={run} elapsed={elapsed} />
      <NodeBreakdown segments={attributed} defaultConnectionId={defaultConnectionId} connections={connections} />

      {visible.map((s, i) => (
        <SegmentView
          key={s.nodeId}
          segment={s}
          first={i === 0}
          last={i === visible.length - 1}
          onResolve={onResolve}
          runId={run.runId}
        />
      ))}

      {run.status === "complete" && (
        <div className="grid grid-cols-[24px_minmax(0,1fr)] pb-2">
          <div />
          <div className="t-meta flex items-baseline gap-2 text-ink-faint">
            <span className="h-px flex-1 bg-line-soft" aria-hidden />
            <span>run complete</span>
          </div>
        </div>
      )}
      {run.status === "stopped" && (
        <div className="grid grid-cols-[24px_minmax(0,1fr)] pb-2">
          <div />
          <div className="t-meta flex items-baseline gap-2" style={{ color: "var(--ink-mute)" }}>
            <span className="h-px flex-1 bg-line-soft" aria-hidden />
            <span>stopped — downstream nodes never ran</span>
          </div>
        </div>
      )}
    </div>
  );
}
