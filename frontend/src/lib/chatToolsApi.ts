/**
 * Chat tools broker client — contract v1.1
 * (.harness/sprint-2026-09-18/story-CHAT-TOOLS-CONTRACT/contract.md §2).
 *
 * Only the read-only half lives here (`capabilities`, `discover`, `read`).
 * `exec` is deliberately NOT a function: per contract §0.2 a command only
 * ever runs inside a `/execute/direct` run, parked on the run's approval
 * gate — see `agent-run/runClient.ts` (`tools.preset`) and `sendControl`.
 *
 * `apiUrl` already carries the sidecar bearer token (lib/apiBase.ts).
 */

import { apiUrl } from "@/lib/apiBase";

export type ProviderKind = "http" | "cli" | "mock";
export type CapabilityReason = "ok" | "no-workspace" | "cli-adapter" | "provider-no-tools" | "mock";

export interface ChatCapabilities {
  workspace: { root: string; name: string } | null;
  provider_kind: ProviderKind;
  /** Model-driven tool loop (contract §3). */
  tools: { discover: boolean; read: boolean; exec: boolean };
  /** User-chosen tools from the `/` menu (contract §2.4). */
  preset: { read: boolean; exec: boolean };
  reason: CapabilityReason;
  limits: {
    read_max_bytes: number;
    exec_timeout_s: number;
    exec_max_timeout_s: number;
    exec_output_max_bytes: number;
    max_tool_calls_per_turn: number;
    max_reads_per_turn: number;
  };
}

export type DiscoverItem =
  | { kind: "skill"; name: string; path: string; description?: string; source: string }
  | { kind: "command"; name: string; path: string; description?: string; argv?: string[]; cwd?: string; source: string };

export interface DiscoverResult {
  root: string;
  items: DiscoverItem[];
  truncated: boolean;
  scanned_dirs: number;
}

export interface ReadResult {
  path: string;
  bytes: number;
  truncated: boolean;
  encoding: string;
  content: string;
  redactions: number;
}

/** Structured error body from the broker (contract §2.3). */
export class ChatToolsError extends Error {
  constructor(public readonly status: number, public readonly code: string, public readonly path?: string) {
    super(`${code} (${status})`);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(apiUrl(path), {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!res.ok) {
    let code = `http_${res.status}`;
    let at: string | undefined;
    try {
      const body = (await res.json()) as { error?: string; path?: string };
      if (body?.error) code = body.error;
      at = body?.path;
    } catch {
      /* non-JSON error body — keep the status code */
    }
    throw new ChatToolsError(res.status, code, at);
  }
  return res.json() as Promise<T>;
}

export const chatToolsApi = {
  capabilities: (cwd: string, connectionId?: string) => {
    const q = new URLSearchParams({ cwd });
    if (connectionId) q.set("connection_id", connectionId);
    return request<ChatCapabilities>(`/chat/tools/capabilities?${q.toString()}`);
  },
  discover: (cwd: string) =>
    request<DiscoverResult>(`/chat/tools/discover?${new URLSearchParams({ cwd }).toString()}`),
  read: (cwd: string, path: string, opts?: { max_bytes?: number; truncate?: boolean }) =>
    request<ReadResult>("/chat/tools/read", {
      method: "POST",
      body: JSON.stringify({ cwd, path, ...opts }),
    }),
};
