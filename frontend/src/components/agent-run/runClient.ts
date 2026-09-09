/**
 * Open a run and pump its SSE frames at the caller.
 *
 * Production is a static Tauri export — there is no Next `/api/run` proxy.
 * Calls go straight to the FastAPI sidecar (`apiUrl` / `window.__OH_API__`).
 */

import { apiUrl } from "@/lib/apiBase";
import type { HarnessGraph } from "@/lib/types";

export interface StartRunPayload {
  graph_json?: HarnessGraph;
  harness_id?: string;
  mode: string;
  step: boolean;
  instruction?: string;
}

function pumpSse(
  url: string,
  payload: unknown,
  onEvent: (event: string, data: Record<string, unknown>) => void,
  onClose: (err?: Error) => void
): () => void {
  const ctrl = new AbortController();

  (async () => {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: ctrl.signal,
      });
      if (!res.ok || !res.body) {
        throw new Error(`${res.status} ${(await res.text()).slice(0, 200)}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // SSE frames are separated by a blank line. Anything after the last
        // separator is a partial frame and stays in the buffer.
        const frames = buffer.split("\n\n");
        buffer = frames.pop() ?? "";
        for (const frame of frames) {
          const name = frame.match(/^event: (.+)$/m)?.[1];
          const data = frame.match(/^data: (.+)$/m)?.[1];
          if (!name || !data) continue;
          try {
            onEvent(name, JSON.parse(data));
          } catch {
            /* a frame we cannot parse is dropped, not fatal */
          }
        }
      }
      onClose();
    } catch (err) {
      if ((err as Error)?.name === "AbortError") onClose();
      else onClose(err as Error);
    }
  })();

  return () => ctrl.abort();
}

export function startRun(
  payload: StartRunPayload,
  onEvent: (event: string, data: Record<string, unknown>) => void,
  onClose: (err?: Error) => void
): () => void {
  return pumpSse(apiUrl("/execute/"), payload, onEvent, onClose);
}

export interface DirectRunPayload {
  instruction: string;
  mode: string;
  step?: boolean;
  adapter?: string;
  model?: string;
}

/** Harness-off path — one adapter turn via `/execute/direct`. */
export function startDirectRun(
  payload: DirectRunPayload,
  onEvent: (event: string, data: Record<string, unknown>) => void,
  onClose: (err?: Error) => void
): () => void {
  return pumpSse(apiUrl("/execute/direct"), payload, onEvent, onClose);
}

export type ControlAction = "stop" | "step" | "resume" | "message";

export async function sendControl(
  runId: string,
  body: {
    action: ControlAction;
    decision?: "approve" | "reject";
    note?: string;
    text?: string;
  }
): Promise<void> {
  await fetch(apiUrl(`/execute/${encodeURIComponent(runId)}/control`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
