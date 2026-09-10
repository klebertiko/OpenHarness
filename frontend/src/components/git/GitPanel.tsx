"use client";

import { useCallback, useEffect, useState } from "react";
import { GitPullRequest, MessageSquare, Plus, RefreshCw } from "lucide-react";

import { Panel } from "@/components/shell/Panel";
import {
  defaultRepoProvider,
  reposApi,
  type PullSummary,
} from "@/lib/reposApi";

/**
 * Agent Git panel — list / create / comment on PRs via `/repos/*` only.
 * Dev: REPO_PROVIDER=fake (NEXT_PUBLIC_REPO_PROVIDER).
 */
export function GitPanel() {
  const provider = defaultRepoProvider();
  const [repo, setRepo] = useState("acme/app");
  const [pulls, setPulls] = useState<PullSummary[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const [title, setTitle] = useState("");
  const [head, setHead] = useState("");
  const [base, setBase] = useState("main");
  const [body, setBody] = useState("");
  const [comment, setComment] = useState("");

  const refresh = useCallback(async () => {
    if (!repo.trim()) return;
    const data = await reposApi.listPulls(provider, repo.trim());
    setPulls(data.pulls);
  }, [provider, repo]);

  useEffect(() => {
    void refresh().catch((err: Error) => setError(err.message));
  }, [refresh]);

  const onCreate = async () => {
    if (!title.trim() || !head.trim()) return;
    setBusy(true);
    setError("");
    try {
      await reposApi.createPull(provider, {
        repo: repo.trim(),
        title: title.trim(),
        head: head.trim(),
        base: base.trim() || "main",
        body: body.trim(),
      });
      setTitle("");
      setHead("");
      setBody("");
      await refresh();
    } catch (err) {
      setError((err as Error).message || "Create failed");
    } finally {
      setBusy(false);
    }
  };

  const onComment = async () => {
    if (selected == null || !comment.trim()) return;
    setBusy(true);
    setError("");
    try {
      await reposApi.comment(provider, selected, repo.trim(), comment.trim());
      setComment("");
    } catch (err) {
      setError((err as Error).message || "Comment failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel title="Pull requests" meta={provider} className="h-full">
      <div className="flex flex-col gap-3 p-2.5 text-[12px]">
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex min-w-[10rem] flex-1 flex-col gap-1 text-ink-mute">
            Repo
            <input
              value={repo}
              onChange={(e) => setRepo(e.target.value)}
              className="h-[28px] rounded-control border border-line bg-sub-200 px-2 text-ink outline-none focus:border-ink-mute"
              placeholder="owner/name"
            />
          </label>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setError("");
              void refresh().catch((err: Error) => setError(err.message));
            }}
            className="inline-flex h-[28px] items-center gap-1 rounded-control border border-line bg-sub-200 px-2 text-ink hover:bg-sub-300"
          >
            <RefreshCw size={12} /> Refresh
          </button>
        </div>

        {error && (
          <p className="text-[11px] text-signal" role="alert">
            {error}
          </p>
        )}

        <div>
          <p className="t-meta mb-1.5 text-ink-faint">Open pulls</p>
          <ul className="space-y-1">
            {pulls.length === 0 && (
              <li className="text-ink-mute">No open pulls.</li>
            )}
            {pulls.map((p) => (
              <li key={p.number}>
                <button
                  type="button"
                  onClick={() => setSelected(p.number)}
                  className={`flex w-full items-start gap-2 rounded-control px-2 py-1.5 text-left ${
                    selected === p.number
                      ? "bg-sub-300 text-ink"
                      : "text-ink hover:bg-sub-200"
                  }`}
                >
                  <GitPullRequest size={14} className="mt-0.5 flex-none text-ink-mute" />
                  <span className="min-w-0 flex-1">
                    <span className="font-[550]">#{p.number}</span> {p.title}
                    <span className="mt-0.5 block text-[10px] text-ink-mute">
                      {p.head} → {p.base}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>

        <div className="border-t border-line-soft pt-2">
          <p className="t-meta mb-1.5 text-ink-faint">Create pull</p>
          <div className="flex flex-col gap-1.5">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Title"
              className="h-[28px] rounded-control border border-line bg-sub-200 px-2 text-ink outline-none focus:border-ink-mute"
            />
            <div className="flex gap-1.5">
              <input
                value={head}
                onChange={(e) => setHead(e.target.value)}
                placeholder="Head branch"
                className="h-[28px] min-w-0 flex-1 rounded-control border border-line bg-sub-200 px-2 text-ink outline-none focus:border-ink-mute"
              />
              <input
                value={base}
                onChange={(e) => setBase(e.target.value)}
                placeholder="Base"
                className="h-[28px] w-[7rem] rounded-control border border-line bg-sub-200 px-2 text-ink outline-none focus:border-ink-mute"
              />
            </div>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Body"
              rows={2}
              className="resize-none rounded-control border border-line bg-sub-200 px-2 py-1.5 text-ink outline-none focus:border-ink-mute"
            />
            <button
              type="button"
              disabled={busy || !title.trim() || !head.trim()}
              onClick={() => void onCreate()}
              className="inline-flex h-[28px] items-center justify-center gap-1.5 rounded-control bg-signal px-2 font-[550] text-signal-ink hover:bg-signal-deep disabled:opacity-40"
            >
              <Plus size={12} /> Create
            </button>
          </div>
        </div>

        <div className="border-t border-line-soft pt-2">
          <p className="t-meta mb-1.5 text-ink-faint">
            Comment {selected == null ? "" : `· #${selected}`}
          </p>
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder={selected == null ? "Select a pull above" : "Review comment"}
            rows={2}
            disabled={selected == null}
            className="mb-1.5 w-full resize-none rounded-control border border-line bg-sub-200 px-2 py-1.5 text-ink outline-none focus:border-ink-mute disabled:opacity-40"
          />
          <button
            type="button"
            disabled={busy || selected == null || !comment.trim()}
            onClick={() => void onComment()}
            className="inline-flex h-[28px] items-center justify-center gap-1.5 rounded-control border border-line bg-sub-200 px-2 text-ink hover:bg-sub-300 disabled:opacity-40"
          >
            <MessageSquare size={12} /> Post comment
          </button>
        </div>
      </div>
    </Panel>
  );
}
