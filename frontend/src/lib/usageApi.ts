/**
 * Usage ledger + global budget — FastAPI sidecar via `apiBase` (static
 * export / Tauri), mirroring automationsApi.ts's shape. The sidecar is the
 * only source of truth for tokens/cost (backend/usage_tracking.py); this
 * client never computes a number itself, only formats what it is given.
 */

import { apiUrl } from "@/lib/apiBase";

export type BudgetState = "unset" | "ok" | "warning" | "exceeded";

export type BudgetStatus = {
  limitUsd: number | null;
  spentUsd: number;
  remainingUsd: number | null;
  pct: number | null;
  state: BudgetState;
};

export type CostEstimate = {
  costComplete?: boolean;
  estimatedCostUsd?: number | null;
};

export type ConnectionUsage = CostEstimate & {
  connectionId: string;
  provider: string;
  tokensTotal: number;
  costUsd: number;
  /** Tokens billed at a rate this catalog doesn't know — never the same
      thing as a genuinely free/local model. See formatCost's docstring. */
  unpricedTokens: number;
};

export type SourceUsage = CostEstimate & {
  source: string;
  tokensTotal: number;
  costUsd: number;
};

export type UsageSummary = CostEstimate & {
  totalTokens: number;
  totalCostUsd: number;
  unpricedTokens: number;
  budget: BudgetStatus;
  byConnection: ConnectionUsage[];
  bySource: SourceUsage[];
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(apiUrl(path), {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json() as Promise<T>;
}

export const usageApi = {
  summary: () => request<UsageSummary>("/usage/summary"),
  getBudget: () => request<BudgetStatus>("/usage/budget"),
  setBudget: (limitUsd: number | null) =>
    request<BudgetStatus>("/usage/budget", {
      method: "PUT",
      body: JSON.stringify({ limitUsd }),
    }),
};

/**
 * Render a connection/model's cost honestly.
 *
 * `isFreeConnection` must be true only for a genuinely free, local/on-device
 * connection (residence === "local") — never for a cloud connection that
 * simply has no price in the catalog yet. Those two both arrive here as
 * `costUsd <= 0`, and conflating them is exactly the "fake $0.00 that looks
 * like a real free cloud call" mistake this feature must not make: a local
 * model reads as "free", an unpriced cloud model reads as "cost unknown".
 *
 * Callers should check `tokensTotal === 0` themselves first and render "—"
 * (no usage recorded at all) rather than calling this — a connection with
 * no usage is a different situation again from one with real-but-unpriced
 * usage.
 */
export function formatCost(costUsd: number, isFreeConnection: boolean): string {
  if (costUsd <= 0) return isFreeConnection ? "free" : "cost unknown";
  return costUsd < 0.01 ? `$${costUsd.toFixed(3)}` : `$${costUsd.toFixed(2)}`;
}
