import type { HarnessGraph, HarnessMeta, ExecutionMode } from "./types";

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json() as Promise<T>;
}

export const api = {
  harnesses: {
    list: () => request<HarnessMeta[]>("/harnesses/"),
    get: (id: string) => request<HarnessMeta & { graph_json: HarnessGraph }>(`/harnesses/${id}`),
    create: (name: string, description: string, graph_json: HarnessGraph) =>
      request<{ id: string; name: string }>("/harnesses/", {
        method: "POST",
        body: JSON.stringify({ name, description, graph_json }),
      }),
    update: (id: string, patch: { name?: string; description?: string; graph_json?: HarnessGraph }) =>
      request<{ id: string; name: string }>(`/harnesses/${id}`, {
        method: "PUT",
        body: JSON.stringify(patch),
      }),
    delete: (id: string) =>
      fetch(`${BASE}/harnesses/${id}`, { method: "DELETE" }),
  },
  execute: (
    payload: { harness_id?: string; graph_json?: HarnessGraph; mode: ExecutionMode },
    onEvent: (event: string, data: unknown) => void,
    onDone: () => void
  ) => {
    const ctrl = new AbortController();
    fetch(`${BASE}/execute/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    }).then(async (res) => {
      if (!res.body) return;
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";
        for (const part of parts) {
          const eventLine = part.match(/^event: (.+)$/m)?.[1];
          const dataLine = part.match(/^data: (.+)$/m)?.[1];
          if (eventLine && dataLine) {
            try {
              onEvent(eventLine, JSON.parse(dataLine));
            } catch {}
          }
        }
      }
      onDone();
    });
    return () => ctrl.abort();
  },
};
