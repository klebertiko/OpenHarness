import { apiUrl } from "../apiBase";
import type { ApiErrorBody, AssistRequest, AssistResponse, PlanRequest, PlanResponse } from "./contract";

export class CopilotApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: ApiErrorBody,
  ) {
    super(`${body.error} (${status})`);
    this.name = "CopilotApiError";
  }
}

async function post<T>(path: string, payload: unknown, signal?: AbortSignal): Promise<T> {
  const res = await fetch(apiUrl(path), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal,
  });
  if (!res.ok) {
    let body: ApiErrorBody = { error: `http_${res.status}` };
    try {
      const parsed = (await res.json()) as Partial<ApiErrorBody>;
      if (parsed && typeof parsed.error === "string") body = parsed as ApiErrorBody;
    } catch {
      /* non-JSON error body — keep the status code */
    }
    throw new CopilotApiError(res.status, body);
  }
  return res.json() as Promise<T>;
}

export const planGraphEdit = (req: PlanRequest, signal?: AbortSignal) =>
  post<PlanResponse>("/studio/copilot/plan", req, signal);

export const assistField = (req: AssistRequest, signal?: AbortSignal) =>
  post<AssistResponse>("/studio/assist/field", req, signal);
