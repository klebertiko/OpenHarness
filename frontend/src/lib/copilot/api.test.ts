import { afterEach, describe, expect, it, vi } from "vitest";
import { CopilotApiError, assistField, planGraphEdit } from "./api";
import type { PlanRequest } from "./contract";

const req: PlanRequest = { message: "hi", history: [], graph: { nodes: [], edges: [] }, mode: "mock", connection_id: null };

afterEach(() => vi.unstubAllGlobals());

describe("copilot api", () => {
  it("planGraphEdit POSTs JSON to /studio/copilot/plan", async () => {
    const body = { summary: "s", ops: [], source: "offline", tokens: 0 };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => body });
    vi.stubGlobal("fetch", fetchMock);
    const ctl = new AbortController();
    expect(await planGraphEdit(req, ctl.signal)).toEqual(body);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://127.0.0.1:8000/studio/copilot/plan");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({ "Content-Type": "application/json" });
    expect(JSON.parse(init.body)).toEqual(req);
    expect(init.signal).toBe(ctl.signal);
  });

  it("assistField POSTs to /studio/assist/field", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ text: "t", notes: [], source: "offline", tokens: 0 }) });
    vi.stubGlobal("fetch", fetchMock);
    await assistField({ field: "systemPrompt", action: "review", node: { type: "agent", label: "A" }, current: "x", mode: "mock" });
    expect(fetchMock.mock.calls[0][0]).toBe("http://127.0.0.1:8000/studio/assist/field");
  });

  it("throws CopilotApiError with the status and parsed body on a non-OK response", async () => {
    const body = { error: "plan_invalid", errors: [{ index: 0, code: "bad_port", message: "no" }] };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 422, json: async () => body }));
    const err = await planGraphEdit(req).catch((e) => e);
    expect(err).toBeInstanceOf(CopilotApiError);
    expect(err.status).toBe(422);
    expect(err.body).toEqual(body);
  });

  it("falls back to an http_<status> body when the error is not JSON", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 502, json: async () => { throw new Error("html"); } }));
    const err = await planGraphEdit(req).catch((e) => e);
    expect(err.body).toEqual({ error: "http_502" });
  });

  it("propagates an abort as AbortError", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new DOMException("aborted", "AbortError")));
    const err = await planGraphEdit(req).catch((e) => e);
    expect(err.name).toBe("AbortError");
    expect(err).not.toBeInstanceOf(CopilotApiError);
  });
});
