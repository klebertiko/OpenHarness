/**
 * Runs API — past harness executions, from the FastAPI sidecar's
 * `/execute/logs` store. List + one detail; the sidecar keeps the last 50.
 */
import { apiUrl } from "@/lib/apiBase";

/** `failed` = the sidecar persisted a classified provider failure (DIRECT-HISTORY AC#4);
    `error` = the engine itself errored. Both are failures to a reader, kept apart for the log. */
export type RunStatus = "running" | "complete" | "error" | "failed" | "stopped";
export type RunSource = "direct" | "harness";

export interface RunLog {
  id: string;
  harnessId: string;
  harnessName: string;
  status: RunStatus;
  /** Chat turn without a harness graph (`/execute/direct`) vs. a harness run. */
  source: RunSource;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface RunLogDetail extends RunLog {
  /** Whatever the engine persisted for the run: node outputs, gate notes, etc. */
  result: Record<string, unknown>;
}

type RawLog = {
  id: string;
  harness_id: string;
  harness_name: string;
  status: string;
  source?: string;
  started_at: string | null;
  finished_at: string | null;
  result?: Record<string, unknown>;
};

function normalize(raw: RawLog): RunLogDetail {
  return {
    id: raw.id,
    harnessId: raw.harness_id,
    harnessName: raw.harness_name,
    status: (["running", "complete", "error", "failed", "stopped"].includes(raw.status)
      ? raw.status
      : "complete") as RunStatus,
    source: raw.source === "direct" ? "direct" : "harness",
    startedAt: raw.started_at,
    finishedAt: raw.finished_at,
    result: raw.result ?? {},
  };
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(apiUrl(path), { cache: "no-store" });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json() as Promise<T>;
}

export const runsApi = {
  list: async (): Promise<RunLog[]> => (await getJson<RawLog[]>("/execute/logs")).map(normalize),
  get: async (id: string): Promise<RunLogDetail> =>
    normalize(await getJson<RawLog>(`/execute/logs/${encodeURIComponent(id)}`)),
};

/** Best-effort human text from a persisted run result, for the detail view. */
export function runResultText(result: Record<string, unknown>): string {
  for (const key of ["output", "summary", "text", "message"]) {
    const v = result[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  const keys = Object.keys(result);
  return keys.length ? JSON.stringify(result, null, 2) : "";
}
