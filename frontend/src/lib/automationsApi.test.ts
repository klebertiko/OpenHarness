import { afterEach, describe, expect, it, vi } from "vitest";

import { automationsApi, effectiveHarnessEnabled } from "./automationsApi";

describe("effectiveHarnessEnabled", () => {
  it("uses job override when boolean", () => {
    expect(effectiveHarnessEnabled(true, false)).toBe(false);
    expect(effectiveHarnessEnabled(false, true)).toBe(true);
  });

  it("falls back to session when override absent", () => {
    expect(effectiveHarnessEnabled(true, null)).toBe(true);
    expect(effectiveHarnessEnabled(false, undefined)).toBe(false);
  });
});

describe("automationsApi.runNow", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // AUTOMATE-CHECKPOINT (Codex PEDIDO 2026-09-18 01:50): the backend's
  // POST /automations/{id}/run now defaults to mode="live" when the body is
  // absent. The panel's "Run simulation" button promised a simulation, so the
  // client must say `mock` explicitly — never rely on the server default.
  it("sends an explicit mode in the request body (default: mock)", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: "j1" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await automationsApi.runNow("j1");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ mode: "mock" });
  });

  it("forwards an explicit live mode when the caller asks for it", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: "j1" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await automationsApi.runNow("j1", "live");

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({ mode: "live" });
  });
});
