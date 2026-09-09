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
};

export type DiffStat = {
  additions: number;
  deletions: number;
  changedFiles: number;
};

export type CreatePullInput = {
  repo: string;
  title: string;
  head: string;
  base: string;
  body?: string;
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(apiUrl(path), {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!res.ok) throw new Error(await res.text());
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
};
