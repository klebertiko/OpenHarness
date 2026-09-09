/**
 * Cowork API — FastAPI sidecar via `apiBase` (static export / Tauri).
 */

import { apiUrl } from "@/lib/apiBase";

export type CoworkProject = {
  id: string;
  name: string;
  rootPath: string;
  instructions: string;
  memoryJson: Record<string, unknown>;
  harnessBundleId: string | null;
  harnessEnabled: boolean;
};

export type CoworkProjectCreate = {
  name: string;
  rootPath?: string;
  instructions?: string;
  memoryJson?: Record<string, unknown>;
  harnessBundleId?: string | null;
  harnessEnabled?: boolean;
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

export const coworkApi = {
  list: () => request<{ projects: CoworkProject[] }>("/cowork/projects"),
  create: (body: CoworkProjectCreate) =>
    request<CoworkProject>("/cowork/projects", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  update: (id: string, body: Partial<CoworkProjectCreate>) =>
    request<CoworkProject>(`/cowork/projects/${id}`, {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  remove: (id: string) =>
    fetch(apiUrl(`/cowork/projects/${id}`), { method: "DELETE" }).then((r) => {
      if (!r.ok) throw new Error(`delete failed: ${r.status}`);
    }),
};
