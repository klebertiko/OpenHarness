"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronDown, ChevronRight, Plus, RefreshCw, Search } from "lucide-react";

import { Panel } from "@/components/shell/Panel";
import {
  defaultRepoProvider,
  isUnsupportedByProvider,
  reposApi,
  RepoApiError,
  type CheckRun,
  type Comment,
  type Commit,
  type DiffStat,
  type PullSummary,
  type Review,
} from "@/lib/reposApi";
import { type DetailErrors, PullDetail } from "./PullDetail";
import { formatRelativeTime } from "./time";

/**
 * Hallmark · macrostructure: Review Bench (design.md).
 *
 * Master-detail, deliberately flatter and denser than Automate's centred
 * list+detail rhythm: a fixed-width list rail (repo entry, search, rows)
 * next to a detail pane that reads like a spec sheet, not a form. "Create
 * pull" is a collapsed disclosure inside the rail — a secondary action, not
 * co-equal real estate with the list.
 *
 * Detail-pane sections trace 1:1 to the six `/repos/{provider}/pulls/...`
 * endpoints (pull, diff, checks, reviews, commits, comments); a section
 * that a provider can't supply says so instead of going blank or faking a
 * value. No mutate endpoints exist yet (reviewer request, status change,
 * merge) so those Codex-reference controls are omitted rather than
 * rendered inert-but-clickable.
 *
 * Nilo does not exist in this checkout yet, so the empty detail state
 * below is plain text rather than her idle pose — add her back here once
 * the mascot component lands.
 */
export function GitPanel() {
  const provider = defaultRepoProvider();
  const [repo, setRepo] = useState("acme/app");
  const [pulls, setPulls] = useState<PullSummary[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const [createOpen, setCreateOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [head, setHead] = useState("");
  const [base, setBase] = useState("main");
  const [body, setBody] = useState("");
  const [comment, setComment] = useState("");

  const [pull, setPull] = useState<PullSummary | null>(null);
  const [diffStat, setDiffStat] = useState<DiffStat | null>(null);
  const [checks, setChecks] = useState<CheckRun[]>([]);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [commits, setCommits] = useState<Commit[]>([]);
  const [comments, setComments] = useState<Comment[]>([]);
  const [detailErrors, setDetailErrors] = useState<DetailErrors>({});
  const [detailLoading, setDetailLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!repo.trim()) return;
    const data = await reposApi.listPulls(provider, repo.trim());
    setPulls(data.pulls);
  }, [provider, repo]);

  useEffect(() => {
    void refresh().catch((err: unknown) => setError(describeError(err)));
  }, [refresh]);

  // Selecting a pull (or changing repo) drives a real detail fetch across
  // all six endpoints. Each is caught independently so one provider gap
  // (e.g. an unsupported endpoint) never blanks the sections that did load.
  useEffect(() => {
    if (selected == null || !repo.trim()) {
      setPull(null);
      setDiffStat(null);
      setChecks([]);
      setReviews([]);
      setCommits([]);
      setComments([]);
      setDetailErrors({});
      return;
    }

    let cancelled = false;
    const r = repo.trim();
    const number = selected;
    setDetailLoading(true);
    setDetailErrors({});

    const section = <T,>(
      key: keyof DetailErrors,
      fn: () => Promise<T>,
      apply: (v: T) => void
    ) =>
      fn()
        .then((v) => {
          if (!cancelled) apply(v);
        })
        .catch((err: unknown) => {
          if (!cancelled) {
            setDetailErrors((prev) => ({ ...prev, [key]: describeError(err) }));
          }
        });

    void Promise.all([
      section("pull", () => reposApi.getPull(provider, number, r), (d) => setPull(d.pull)),
      section("diff", () => reposApi.diff(provider, number, r), (d) => setDiffStat(d.diff)),
      section("checks", () => reposApi.listChecks(provider, number, r), (d) => setChecks(d.checks)),
      section("reviews", () => reposApi.listReviews(provider, number, r), (d) => setReviews(d.reviews)),
      section("commits", () => reposApi.listCommits(provider, number, r), (d) => setCommits(d.commits)),
      section("comments", () => reposApi.listComments(provider, number, r), (d) => setComments(d.comments)),
    ]).finally(() => {
      if (!cancelled) setDetailLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [provider, repo, selected]);

  const onCreate = async () => {
    if (!title.trim() || !head.trim()) return;
    setBusy(true);
    setError("");
    try {
      const created = await reposApi.createPull(provider, {
        repo: repo.trim(),
        title: title.trim(),
        head: head.trim(),
        base: base.trim() || "main",
        body: body.trim(),
      });
      setTitle("");
      setHead("");
      setBody("");
      setCreateOpen(false);
      await refresh();
      setSelected(created.pull.number);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  };

  const onComment = async () => {
    if (selected == null || !comment.trim() || !repo.trim()) return;
    setBusy(true);
    setError("");
    try {
      await reposApi.comment(provider, selected, repo.trim(), comment.trim());
      setComment("");
      // The POST response carries no comment body/id/timestamp — refetch
      // the real list rather than fabricating those fields client-side.
      const res = await reposApi.listComments(provider, selected, repo.trim());
      setComments(res.comments);
      setDetailErrors((prev) => ({ ...prev, comments: undefined }));
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  };

  const q = search.trim().toLowerCase();
  const filteredPulls = q
    ? pulls.filter((p) => `${p.title} ${p.head} ${p.base} #${p.number}`.toLowerCase().includes(q))
    : pulls;

  return (
    <Panel title="Pull requests" meta={provider} className="h-full">
      <div className="flex h-full min-h-0">
        <div className="flex h-full min-h-0 w-[212px] flex-none flex-col border-r border-line-soft">
          <div className="flex-none border-b border-line-soft p-2">
            <div className="flex items-center gap-1">
              <label className="sr-only" htmlFor="git-panel-repo">
                Repository
              </label>
              <input
                id="git-panel-repo"
                value={repo}
                onChange={(e) => setRepo(e.target.value)}
                placeholder="owner/name"
                className="h-[26px] min-w-0 flex-1 rounded-control border border-line bg-sub-200 px-2 text-[11px] text-ink outline-none focus:border-ink-mute"
              />
              <button
                type="button"
                disabled={busy}
                title="Refresh pull requests"
                aria-label="Refresh pull requests"
                onClick={() => {
                  setError("");
                  void refresh().catch((err: unknown) => setError(describeError(err)));
                }}
                className="oh-focus-inner flex h-[26px] w-[26px] flex-none items-center justify-center rounded-control border border-line bg-sub-200 text-ink-mute hover:bg-sub-300 hover:text-ink"
              >
                <RefreshCw size={12} />
              </button>
            </div>
            <div className="relative mt-1.5">
              <Search size={11} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-ink-faint" aria-hidden />
              <label className="sr-only" htmlFor="git-panel-search">
                Search pull requests
              </label>
              <input
                id="git-panel-search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search"
                className="h-[24px] w-full rounded-control border border-line bg-sub-200 pl-6 pr-2 text-[11px] text-ink outline-none focus:border-ink-mute"
              />
            </div>
          </div>

          {error && (
            <p className="t-meta border-b border-line-soft px-2.5 py-1.5 text-fault" role="alert">
              {error}
            </p>
          )}

          <div className="min-h-0 flex-1 overflow-y-auto">
            {filteredPulls.length === 0 ? (
              <p className="t-body px-2.5 py-3 text-ink-faint">
                {pulls.length === 0 ? "No open pulls." : "No matches."}
              </p>
            ) : (
              <ul>
                {filteredPulls.map((p) => (
                  <li key={p.number}>
                    <button
                      type="button"
                      onClick={() => setSelected(p.number)}
                      aria-current={selected === p.number}
                      className={`oh-focus-inner flex w-full flex-col items-start gap-0.5 px-2.5 py-2 text-left ${
                        selected === p.number ? "bg-sub-300" : "hover:bg-sub-200"
                      }`}
                    >
                      <span className="flex w-full items-center gap-1.5">
                        <span
                          className={`t-body min-w-0 flex-1 truncate ${
                            selected === p.number ? "text-ink" : "text-ink-dim"
                          }`}
                        >
                          {p.title}
                        </span>
                        {p.draft && <span className="t-meta flex-none text-warn">draft</span>}
                      </span>
                      <span className="t-meta w-full truncate font-mono text-ink-faint">
                        {p.head} → {p.base}
                      </span>
                      <span className="t-meta text-ink-faint">
                        #{p.number} · {formatRelativeTime(p.updatedAt || p.createdAt)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="flex-none border-t border-line-soft">
            <button
              type="button"
              onClick={() => setCreateOpen((v) => !v)}
              aria-expanded={createOpen}
              className="oh-focus-inner flex w-full items-center gap-1.5 px-2.5 py-1.5 text-left"
            >
              {createOpen ? (
                <ChevronDown size={12} className="flex-none text-ink-faint" aria-hidden />
              ) : (
                <ChevronRight size={12} className="flex-none text-ink-faint" aria-hidden />
              )}
              <Plus size={12} className="flex-none text-ink-faint" aria-hidden />
              <span className="t-label text-ink-mute">New pull request</span>
            </button>
            {createOpen && (
              <div className="flex flex-col gap-1.5 px-2.5 pb-2.5">
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Title"
                  aria-label="New pull request title"
                  className="h-[26px] rounded-control border border-line bg-sub-200 px-2 text-[11px] text-ink outline-none focus:border-ink-mute"
                />
                <div className="flex gap-1.5">
                  <input
                    value={head}
                    onChange={(e) => setHead(e.target.value)}
                    placeholder="Head branch"
                    aria-label="Head branch"
                    className="h-[26px] min-w-0 flex-1 rounded-control border border-line bg-sub-200 px-2 text-[11px] text-ink outline-none focus:border-ink-mute"
                  />
                  <input
                    value={base}
                    onChange={(e) => setBase(e.target.value)}
                    placeholder="Base"
                    aria-label="Base branch"
                    className="h-[26px] w-[5.5rem] rounded-control border border-line bg-sub-200 px-2 text-[11px] text-ink outline-none focus:border-ink-mute"
                  />
                </div>
                <textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  placeholder="Body"
                  rows={2}
                  aria-label="New pull request description"
                  className="resize-none rounded-control border border-line bg-sub-200 px-2 py-1.5 text-[11px] text-ink outline-none focus:border-ink-mute"
                />
                <button
                  type="button"
                  disabled={busy || !title.trim() || !head.trim()}
                  onClick={() => void onCreate()}
                  className="inline-flex h-[26px] items-center justify-center gap-1.5 rounded-control bg-signal px-2 text-[11px] font-[550] text-signal-ink hover:bg-signal-deep disabled:opacity-40"
                >
                  <Plus size={12} /> Create
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="min-h-0 flex-1">
          {selected == null ? (
            <div className="flex h-full min-h-0 flex-col items-start justify-center px-5">
              <p className="t-body text-ink-mute">Select a pull request to see its details.</p>
            </div>
          ) : (
            <PullDetail
              pull={pull}
              diff={diffStat}
              checks={checks}
              reviews={reviews}
              commits={commits}
              comments={comments}
              errors={detailErrors}
              loading={detailLoading}
              comment={comment}
              onCommentChange={setComment}
              onPostComment={() => void onComment()}
              busy={busy}
            />
          )}
        </div>
      </div>
    </Panel>
  );
}

function describeError(err: unknown): string {
  if (err instanceof RepoApiError) {
    if (isUnsupportedByProvider(err)) return "Not supported for this provider.";
    return err.message || "Request failed.";
  }
  if (err instanceof Error) return err.message || "Request failed.";
  return "Request failed.";
}
