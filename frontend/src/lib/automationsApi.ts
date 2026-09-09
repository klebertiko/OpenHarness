/**
 * Same-origin Automations API — proxied to the FastAPI sidecar via Next rewrites.
 */

export type AutomationJob = {
  id: string;
  name: string;
  cron: string | null;
  projectId: string | null;
  harnessBundleId: string | null;
  harnessEnabled: boolean;
  lastRunAt: string | null;
  status: string;
  result?: { ok?: boolean; harnessEnabled?: boolean; mode?: string };
};

export type AutomationJobCreate = {
  name: string;
  cron?: string | null;
  projectId?: string | null;
  harnessBundleId?: string | null;
  harnessEnabled?: boolean;
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!res.ok) throw new Error(await res.text());
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const automationsApi = {
  list: () => request<{ jobs: AutomationJob[] }>("/automations/"),
  create: (body: AutomationJobCreate) =>
    request<AutomationJob>("/automations/", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  update: (id: string, body: Partial<AutomationJobCreate>) =>
    request<AutomationJob>(`/automations/${id}`, {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  runNow: (id: string) =>
    request<AutomationJob>(`/automations/${id}/run`, { method: "POST" }),
  remove: (id: string) =>
    fetch(`/automations/${id}`, { method: "DELETE" }).then((r) => {
      if (!r.ok) throw new Error(`delete failed: ${r.status}`);
    }),
};

/** Job harness flag wins when set; otherwise fall back to session harness. */
export function effectiveHarnessEnabled(
  sessionEnabled: boolean,
  jobOverride: boolean | null | undefined
): boolean {
  if (typeof jobOverride === "boolean") return jobOverride;
  return sessionEnabled;
}
