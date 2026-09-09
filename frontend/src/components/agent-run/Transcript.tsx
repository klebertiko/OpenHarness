"use client";
import { useEffect, useRef, useState } from "react";
import { ROLE_ICON, ROLE_VAR } from "@/lib/roles";
import css from "./agentRun.module.css";
import { latency as fmtLatency, paragraphs, tokens as fmtTokens } from "./format";
import { Gate } from "./Gate";
import type { Block, RunState, Segment, ToolCall } from "./types";

/* ── Marker ────────────────────────────────────────────────────────────────
   The glyph hanging off the spine. Shape carries state, colour carries role —
   so a run reads correctly in a screenshot, and would still read correctly to
   someone who cannot separate the nine role hues. */
function Marker({ segment }: { segment: Segment }) {
  const role = ROLE_VAR[segment.type];
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
function ToolRow({ call }: { call: ToolCall }) {
  const [open, setOpen] = useState(false);
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

function BlockView({ block, streaming }: { block: Block; streaming: boolean }) {
  if (block.kind === "tool") return <ToolRow call={block.call} />;
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
}: {
  segment: Segment;
  first: boolean;
  last: boolean;
  onResolve: (decision: "approve" | "reject", note: string) => void;
}) {
  const Icon = ROLE_ICON[segment.type];
  const role = ROLE_VAR[segment.type];
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
          <BlockView key={i} block={b} streaming={running && i === lastBlockIndex} />
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

/* ── The transcript ───────────────────────────────────────────────────────── */
export function Transcript({
  run,
  onResolve,
}: {
  run: RunState;
  onResolve: (decision: "approve" | "reject", note: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

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

      {visible.map((s, i) => (
        <SegmentView
          key={s.nodeId}
          segment={s}
          first={i === 0}
          last={i === visible.length - 1}
          onResolve={onResolve}
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
