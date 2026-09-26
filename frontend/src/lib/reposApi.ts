/**
 * Repos API — FastAPI sidecar via `apiBase` (static export / Tauri).
 * Dev default provider is `fake` (REPO_PROVIDER / NEXT_PUBLIC_REPO_PROVIDER).
 */

import { apiUrl } from "@/lib/apiBase";

export type PullSummary = {
  number: number;
  title: string;
  state: string;
  head: string;
  base: string;
  url: string;
  body: string;
  author: string;
  authorAvatarUrl: string;
  createdAt: string;
  updatedAt: string;
  draft: boolean;
  merged: boolean;
  /** `null` = provider hasn't computed mergeability yet — never coerce to true/false. */
  mergeable: boolean | null;
  headSha: string;
};

export type DiffStat = {
  additions: number;
  deletions: number;
  changedFiles: number;
};

export type Comment = {
  id: number;
  author: string;
  authorAvatarUrl: string;
  body: string;
  createdAt: string;
};

/**
 * `state` is one of `approved | changes_requested | commented | pending |
 * dismissed` for providers that model all of them (GitHub); GitLab only
 * ever emits `approved` — a real provider gap, not something to paper over.
 */
export type Review = {
  id: number;
  author: string;
  authorAvatarUrl: string;
  state: string;
  submittedAt: string;
};

export type CheckRun = {
  name: string;
  /** queued | in_progress | completed */
  status: string;
  /** success | failure | neutral | cancelled | skipped | "" (not concluded) */
  conclusion: string;
  url: string;
};

export type Commit = {
  sha: string;
  message: string;
  author: string;
  authoredAt: string;
};

export type CreatePullInput = {
  repo: string;
  title: string;
  head: string;
  base: string;
  body?: string;
};

/** Error raised by `request()` for a non-OK response. Carries the backend's
 * machine-readable `code` (e.g. `pull_not_found`, `...unsupported_platform`,
 * `...not_implemented`) when the body follows the `{ detail: { code,
 * message } }` shape, so callers can render an honest "not supported for
 * this provider" message instead of a raw error dump. */
export class RepoApiError extends Error {
  code?: string;
  status: number;

  constructor(message: string, opts: { code?: string; status: number }) {
    super(message);
    this.name = "RepoApiError";
    this.code = opts.code;
    this.status = opts.status;
  }
}

/** True when the backend rejected the call because this provider genuinely
 * doesn't support the operation (e.g. origin adapter, no PR concept). */
export function isUnsupportedByProvider(err: unknown): boolean {
  return (
    err instanceof RepoApiError &&
    (err.code?.endsWith("unsupported_platform") || err.code?.endsWith("not_implemented")) === true
  );
}

function parseErrorBody(text: string): { message: string; code?: string } {
  try {
    const parsed = JSON.parse(text) as { detail?: { message?: string; code?: string } | string };
    const detail = parsed?.detail;
    if (typeof detail === "string" && detail) return { message: detail };
    if (detail && typeof detail === "object" && detail.message) {
      return { message: detail.message, code: detail.code };
    }
  } catch {
    // Not JSON — fall through to the raw text below.
  }
  return { message: text };
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(apiUrl(path), {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!res.ok) {
    const { message, code } = parseErrorBody(await res.text());
    throw new RepoApiError(message, { code, status: res.status });
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

/** Active repo provider id for Agent Git panel (fake in local dev). */
export function defaultRepoProvider(): string {
  return (
    process.env.NEXT_PUBLIC_REPO_PROVIDER?.trim() ||
    process.env.REPO_PROVIDER?.trim() ||
    "fake"
  );
}

export const reposApi = {
  listPulls: (provider: string, repo: string, state = "open") =>
    request<{ provider: string; repo: string; pulls: PullSummary[] }>(
      `/repos/${provider}/pulls?repo=${encodeURIComponent(repo)}&state=${encodeURIComponent(state)}`
    ),
  createPull: (provider: string, body: CreatePullInput) =>
    request<{ provider: string; pull: PullSummary }>(`/repos/${provider}/pulls`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  comment: (provider: string, number: number, repo: string, body: string) =>
    request<{ ok: boolean }>(`/repos/${provider}/pulls/${number}/comments`, {
      method: "POST",
      body: JSON.stringify({ repo, body }),
    }),
  diff: (provider: string, number: number, repo: string) =>
    request<{ diff: DiffStat }>(
      `/repos/${provider}/pulls/${number}/diff?repo=${encodeURIComponent(repo)}`
    ),
  prWatch: (provider: string, repo: string) =>
    request<{ type: string; openCount: number }>(
      `/repos/${provider}/pr-watch?repo=${encodeURIComponent(repo)}`,
      { method: "POST" }
    ),
  getPull: (provider: string, number: number, repo: string) =>
    request<{ provider: string; pull: PullSummary }>(
      `/repos/${provider}/pulls/${number}?repo=${encodeURIComponent(repo)}`
    ),
  listComments: (provider: string, number: number, repo: string) =>
    request<{ provider: string; number: number; comments: Comment[] }>(
      `/repos/${provider}/pulls/${number}/comments?repo=${encodeURIComponent(repo)}`
    ),
  listReviews: (provider: string, number: number, repo: string) =>
    request<{ provider: string; number: number; reviews: Review[] }>(
      `/repos/${provider}/pulls/${number}/reviews?repo=${encodeURIComponent(repo)}`
    ),
  listChecks: (provider: string, number: number, repo: string) =>
    request<{ provider: string; number: number; checks: CheckRun[] }>(
      `/repos/${provider}/pulls/${number}/checks?repo=${encodeURIComponent(repo)}`
    ),
  listCommits: (provider: string, number: number, repo: string) =>
    request<{ provider: string; number: number; commits: Commit[] }>(
      `/repos/${provider}/pulls/${number}/commits?repo=${encodeURIComponent(repo)}`
    ),
};
