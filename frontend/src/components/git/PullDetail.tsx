"use client";

import { useState } from "react";
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  ExternalLink,
  GitCommit,
  Loader2,
  MessageSquare,
  MinusCircle,
  XCircle,
} from "lucide-react";

import type { CheckRun, Comment, Commit, DiffStat, PullSummary, Review } from "@/lib/reposApi";
import { type ActivityItem, buildActivity } from "./activity";
import { Avatar } from "./Avatar";
import { parseDescription } from "./checklist";
import { formatRelativeTime } from "./time";

export type DetailSection = "pull" | "diff" | "checks" | "reviews" | "commits" | "comments";
export type DetailErrors = Partial<Record<DetailSection, string>>;

type IconType = typeof CheckCircle2;

function Badge({
  children,
  tone = "mute",
}: {
  children: React.ReactNode;
  tone?: "mute" | "signal" | "warn" | "fault";
}) {
  const color =
    tone === "signal"
      ? "var(--signal)"
      : tone === "warn"
        ? "var(--warn)"
        : tone === "fault"
          ? "var(--fault)"
          : "var(--ink-mute)";
  return (
    <span
      className="t-meta inline-flex items-center gap-1 rounded-control border px-1.5 py-px"
      style={{ borderColor: color, color }}
    >
      {children}
    </span>
  );
}

function ErrorNote({ children }: { children: React.ReactNode }) {
  return (
    <p className="t-meta text-ink-faint" role="status">
      {children}
    </p>
  );
}

function SectionHeader({
  title,
  meta,
  open,
  onToggle,
}: {
  title: string;
  meta?: string;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      className="oh-focus-inner flex w-full items-center gap-1.5 py-1.5 text-left"
    >
      {open ? (
        <ChevronDown size={13} className="flex-none text-ink-faint" aria-hidden />
      ) : (
        <ChevronRight size={13} className="flex-none text-ink-faint" aria-hidden />
      )}
      <span className="t-label text-ink-mute">{title}</span>
      {meta && <span className="t-meta text-ink-faint">{meta}</span>}
    </button>
  );
}

function MetaRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[68px_1fr] items-start gap-x-2 py-1">
      <dt className="t-meta pt-px text-ink-faint">{label}</dt>
      <dd className="t-body min-w-0 text-ink-dim">{children}</dd>
    </div>
  );
}

function mergeableLabel(m: boolean | null): { text: string; tone: "signal" | "fault" | "mute" } {
  if (m === true) return { text: "No conflicts", tone: "signal" };
  if (m === false) return { text: "Conflicts", tone: "fault" };
  return { text: "Not yet computed", tone: "mute" };
}

function statusLabel(pull: PullSummary): string {
  if (pull.merged) return "Merged";
  if (pull.state === "closed") return "Closed";
  if (pull.draft) return "Draft";
  return pull.state || "Open";
}

function checksSummary(checks: CheckRun[]): { text: string; tone: "signal" | "fault" | "mute" } {
  if (checks.length === 0) return { text: "No checks", tone: "mute" };
  const failing = checks.filter((c) => c.conclusion === "failure").length;
  const pending = checks.filter((c) => c.status !== "completed").length;
  const passing = checks.filter((c) => c.conclusion === "success").length;
  if (failing > 0) return { text: `${failing} failing`, tone: "fault" };
  if (pending > 0) return { text: `${pending} running`, tone: "mute" };
  return { text: `${passing} passing`, tone: "signal" };
}

function checkVisual(c: CheckRun): { Icon: IconType; color: string; label: string; spin?: boolean } {
  if (c.conclusion === "success") return { Icon: CheckCircle2, color: "var(--signal)", label: "Passed" };
  if (c.conclusion === "failure") return { Icon: XCircle, color: "var(--fault)", label: "Failed" };
  if (c.conclusion === "cancelled") return { Icon: MinusCircle, color: "var(--ink-faint)", label: "Cancelled" };
  if (c.conclusion === "skipped") return { Icon: MinusCircle, color: "var(--ink-faint)", label: "Skipped" };
  if (c.conclusion === "neutral") return { Icon: MinusCircle, color: "var(--ink-faint)", label: "Neutral" };
  if (c.status === "in_progress") {
    return { Icon: Loader2, color: "var(--ink-dim)", label: "Running", spin: true };
  }
  return { Icon: Clock, color: "var(--ink-faint)", label: c.status === "queued" ? "Queued" : c.status || "Pending" };
}

function reviewVisual(r: Review): { Icon: IconType; color: string; label: string } {
  switch (r.state) {
    case "approved":
      return { Icon: CheckCircle2, color: "var(--signal)", label: "approved" };
    case "changes_requested":
      return { Icon: XCircle, color: "var(--fault)", label: "requested changes" };
    case "commented":
      return { Icon: MessageSquare, color: "var(--ink-dim)", label: "commented" };
    case "dismissed":
      return { Icon: MinusCircle, color: "var(--ink-faint)", label: "dismissed" };
    default:
      return { Icon: Clock, color: "var(--ink-faint)", label: r.state || "pending" };
  }
}

function latestReviewsByAuthor(reviews: Review[]): Review[] {
  const byAuthor = new Map<string, Review>();
  for (const r of reviews) {
    const prev = byAuthor.get(r.author);
    if (!prev || Date.parse(r.submittedAt || "") >= Date.parse(prev.submittedAt || "")) {
      byAuthor.set(r.author, r);
    }
  }
  return [...byAuthor.values()];
}

function ActivityRow({ item }: { item: ActivityItem }) {
  const time = formatRelativeTime(item.ts);
  if (item.kind === "commit") {
    const c: Commit = item.item;
    return (
      <li className="flex items-start gap-2 py-1.5">
        <GitCommit size={13} className="mt-0.5 flex-none text-ink-faint" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="t-body truncate text-ink-dim">{c.message || "(no message)"}</p>
          <p className="t-meta text-ink-faint">
            <span className="font-mono">{c.sha ? c.sha.slice(0, 7) : "—"}</span> · {c.author || "unknown"} · {time}
          </p>
        </div>
      </li>
    );
  }
  if (item.kind === "review") {
    const r: Review = item.item;
    const v = reviewVisual(r);
    return (
      <li className="flex items-start gap-2 py-1.5">
        <v.Icon size={13} className="mt-0.5 flex-none" style={{ color: v.color }} aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="t-body text-ink-dim">
            <span className="font-[550]">{r.author || "unknown"}</span> {v.label}
          </p>
          <p className="t-meta text-ink-faint">{time}</p>
        </div>
      </li>
    );
  }
  const c: Comment = item.item;
  return (
    <li className="flex items-start gap-2 py-1.5">
      <Avatar name={c.author} src={c.authorAvatarUrl} size={16} />
      <div className="min-w-0 flex-1">
        <p className="t-meta text-ink-faint">
          <span className="t-body font-[550] text-ink-dim">{c.author || "unknown"}</span> · {time}
        </p>
        <p className="t-body whitespace-pre-wrap text-ink-dim">{c.body}</p>
      </div>
    </li>
  );
}

export interface PullDetailProps {
  pull: PullSummary | null;
  diff: DiffStat | null;
  checks: CheckRun[];
  reviews: Review[];
  commits: Commit[];
  comments: Comment[];
  errors: DetailErrors;
  loading: boolean;
  comment: string;
  onCommentChange: (v: string) => void;
  onPostComment: () => void;
  busy: boolean;
}

/**
 * Detail pane for one selected pull request. Every value shown traces to a
 * real field from one of six endpoints (pull / diff / checks / reviews /
 * commits / comments) — a section that failed to load says so instead of
 * disappearing or showing a fabricated placeholder.
 */
export function PullDetail({
  pull,
  diff,
  checks,
  reviews,
  commits,
  comments,
  errors,
  loading,
  comment,
  onCommentChange,
  onPostComment,
  busy,
}: PullDetailProps) {
  const [openDesc, setOpenDesc] = useState(true);
  const [openChecks, setOpenChecks] = useState(true);
  const [openActivity, setOpenActivity] = useState(true);

  if (!pull) {
    return (
      <div className="flex h-full min-h-0 flex-col p-4">
        {loading ? (
          <p className="t-body text-ink-mute">Loading pull request…</p>
        ) : (
          <p className="t-body text-fault" role="alert">
            {errors.pull || "Could not load this pull request."}
          </p>
        )}
      </div>
    );
  }

  const activity = buildActivity(commits, reviews, comments);
  const checksState = checksSummary(checks);
  const mergeable = mergeableLabel(pull.mergeable);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <header className="border-b border-line-soft px-3 pb-2.5 pt-3">
          <div className="flex items-start gap-2">
            <h1 className="t-title flex-1 text-ink">{pull.title}</h1>
            {pull.url && (
              <a
                href={pull.url}
                target="_blank"
                rel="noreferrer"
                title="Open on provider"
                aria-label="Open on provider"
                className="oh-focus-inner flex-none text-ink-faint hover:text-ink"
              >
                <ExternalLink size={13} />
              </a>
            )}
          </div>
          <div className="t-meta mt-1.5 flex flex-wrap items-center gap-1.5 text-ink-faint">
            <Avatar name={pull.author} src={pull.authorAvatarUrl} size={14} />
            <span>{pull.author || "unknown"}</span>
            <span aria-hidden>·</span>
            <span>#{pull.number}</span>
            <span aria-hidden>·</span>
            <span>opened {formatRelativeTime(pull.createdAt)}</span>
            {pull.draft && <Badge tone="warn">Draft</Badge>}
            {pull.merged && <Badge tone="signal">Merged</Badge>}
          </div>
        </header>

        <dl className="px-3 py-1.5">
          <MetaRow label="Branch">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="font-mono text-ink">
                {pull.head} <span className="text-ink-faint">→</span> {pull.base}
              </span>
              {errors.diff ? (
                <ErrorNote>{errors.diff}</ErrorNote>
              ) : diff ? (
                <span className="font-mono text-[10.5px]">
                  <span className="text-signal">+{diff.additions}</span>{" "}
                  <span className="text-fault">-{diff.deletions}</span>{" "}
                  <span className="text-ink-faint">· {diff.changedFiles} files</span>
                </span>
              ) : (
                <span className="t-meta text-ink-faint">diff loading…</span>
              )}
            </div>
          </MetaRow>

          <MetaRow label="Mergeable">
            <Badge tone={mergeable.tone}>{mergeable.text}</Badge>
          </MetaRow>

          <MetaRow label="Reviewers">
            {errors.reviews ? (
              <ErrorNote>{errors.reviews}</ErrorNote>
            ) : reviews.length === 0 ? (
              <span className="t-body text-ink-faint">No reviewers yet.</span>
            ) : (
              <ul className="flex flex-wrap gap-x-2.5 gap-y-1">
                {latestReviewsByAuthor(reviews).map((r) => {
                  const v = reviewVisual(r);
                  return (
                    <li key={r.id} className="inline-flex items-center gap-1">
                      <Avatar name={r.author} src={r.authorAvatarUrl} size={14} />
                      <span className="t-meta text-ink-dim">{r.author}</span>
                      <v.Icon size={11} style={{ color: v.color }} aria-label={v.label} />
                    </li>
                  );
                })}
              </ul>
            )}
          </MetaRow>

          <MetaRow label="Comments">
            {errors.comments ? (
              <ErrorNote>{errors.comments}</ErrorNote>
            ) : (
              <span className="t-body text-ink-dim">{comments.length}</span>
            )}
          </MetaRow>

          <MetaRow label="Checks">
            {errors.checks ? <ErrorNote>{errors.checks}</ErrorNote> : <Badge tone={checksState.tone}>{checksState.text}</Badge>}
          </MetaRow>

          <MetaRow label="Status">
            <span className="t-body text-ink-dim">{statusLabel(pull)}</span>
          </MetaRow>
        </dl>

        <section className="border-t border-line-soft px-3">
          <SectionHeader title="Description" open={openDesc} onToggle={() => setOpenDesc((v) => !v)} />
          {openDesc && (
            <div className="pb-2.5 pl-[19px]">
              {pull.body.trim() === "" ? (
                <p className="t-body text-ink-faint">No description provided.</p>
              ) : (
                <div className="flex flex-col gap-1">
                  {parseDescription(pull.body).map((line, i) =>
                    line.kind === "checkbox" ? (
                      <label key={i} className="t-body flex items-start gap-1.5 text-ink-dim">
                        <input
                          type="checkbox"
                          checked={line.checked}
                          disabled
                          readOnly
                          className="mt-[3px] flex-none accent-[var(--signal)]"
                        />
                        <span className={line.checked ? "text-ink-faint line-through" : ""}>{line.text}</span>
                      </label>
                    ) : line.text.trim() === "" ? (
                      <div key={i} className="h-1.5" aria-hidden />
                    ) : (
                      <p key={i} className="t-body whitespace-pre-wrap text-ink-dim">
                        {line.text}
                      </p>
                    )
                  )}
                </div>
              )}
            </div>
          )}
        </section>

        <section className="border-t border-line-soft px-3">
          <SectionHeader
            title="Checks"
            meta={checks.length ? `${checks.length}` : undefined}
            open={openChecks}
            onToggle={() => setOpenChecks((v) => !v)}
          />
          {openChecks && (
            <div className="pb-2.5 pl-[19px]">
              {errors.checks ? (
                <ErrorNote>{errors.checks}</ErrorNote>
              ) : checks.length === 0 ? (
                <p className="t-body text-ink-faint">No checks reported yet.</p>
              ) : (
                <ul className="flex flex-col divide-y divide-line-soft">
                  {checks.map((c) => {
                    const v = checkVisual(c);
                    return (
                      <li key={c.name} className="flex items-center gap-2 py-1.5">
                        <v.Icon
                          size={13}
                          className={v.spin ? "flex-none animate-spin" : "flex-none"}
                          style={{ color: v.color }}
                          aria-hidden
                        />
                        <span className="t-body min-w-0 flex-1 truncate text-ink-dim">{c.name}</span>
                        <span className="t-meta flex-none" style={{ color: v.color }}>
                          {v.label}
                        </span>
                        {c.url && (
                          <a
                            href={c.url}
                            target="_blank"
                            rel="noreferrer"
                            title={`Open ${c.name} on provider`}
                            aria-label={`Open ${c.name} on provider`}
                            className="oh-focus-inner flex-none text-ink-faint hover:text-ink"
                          >
                            <ExternalLink size={11} />
                          </a>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}
        </section>

        <section className="border-t border-line-soft px-3">
          <SectionHeader
            title="Activity"
            meta={`${activity.length}`}
            open={openActivity}
            onToggle={() => setOpenActivity((v) => !v)}
          />
          {openActivity && (
            <div className="pb-2 pl-[19px]">
              {(errors.commits || errors.reviews || errors.comments) && (
                <div className="mb-1 flex flex-col gap-0.5">
                  {errors.commits && <ErrorNote>Commits: {errors.commits}</ErrorNote>}
                  {errors.reviews && <ErrorNote>Reviews: {errors.reviews}</ErrorNote>}
                  {errors.comments && <ErrorNote>Comments: {errors.comments}</ErrorNote>}
                </div>
              )}
              {activity.length === 0 ? (
                <p className="t-body text-ink-faint">No activity yet.</p>
              ) : (
                <ul className="flex flex-col divide-y divide-line-soft">
                  {activity.map((a, i) => (
                    <ActivityRow key={`${a.kind}-${i}`} item={a} />
                  ))}
                </ul>
              )}
            </div>
          )}
        </section>
      </div>

      <div className="flex-none border-t border-line px-3 py-2">
        <textarea
          value={comment}
          onChange={(e) => onCommentChange(e.target.value)}
          placeholder={`Comment on #${pull.number}`}
          rows={2}
          aria-label={`Comment on pull request #${pull.number}`}
          className="mb-1.5 w-full resize-none rounded-control border border-line bg-sub-200 px-2 py-1.5 text-[12px] text-ink outline-none focus:border-ink-mute"
        />
        <button
          type="button"
          disabled={busy || !comment.trim()}
          onClick={onPostComment}
          className="inline-flex h-[26px] items-center justify-center gap-1.5 rounded-control border border-line bg-sub-200 px-2 text-[11px] text-ink hover:bg-sub-300 disabled:opacity-40"
        >
          <MessageSquare size={12} /> Post comment
        </button>
      </div>
    </div>
  );
}
