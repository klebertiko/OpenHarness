import { beforeEach, describe, expect, it, vi } from "vitest";

import { usageApi } from "./usageApi";

const BASE = "http://127.0.0.1:8000";

describe("usageApi", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("summary() fetches GET /usage/summary", async () => {
    const body = {
      totalTokens: 100_000,
      totalCostUsd: 0.9,
      unpricedTokens: 0,
      budget: { limitUsd: 10, spentUsd: 0.9, remainingUsd: 9.1, pct: 0.09, state: "ok" },
      byConnection: [],
      bySource: [],
    };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => body });
    vi.stubGlobal("fetch", fetchMock);

    const res = await usageApi.summary();

    expect(fetchMock).toHaveBeenCalledWith(
      `${BASE}/usage/summary`,
      expect.objectContaining({ headers: { "Content-Type": "application/json" } })
    );
    expect(res).toEqual(body);
  });

  it("getBudget() fetches GET /usage/budget", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ limitUsd: null, spentUsd: 0, remainingUsd: null, pct: null, state: "unset" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const res = await usageApi.getBudget();

    expect(fetchMock).toHaveBeenCalledWith(`${BASE}/usage/budget`, expect.anything());
    expect(res.state).toBe("unset");
  });

  it("setBudget() PUTs the new limit and returns the updated status", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ limitUsd: 25, spentUsd: 0, remainingUsd: 25, pct: 0, state: "ok" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const res = await usageApi.setBudget(25);

    expect(fetchMock).toHaveBeenCalledWith(
      `${BASE}/usage/budget`,
      expect.objectContaining({ method: "PUT", body: JSON.stringify({ limitUsd: 25 }) })
    );
    expect(res.limitUsd).toBe(25);
  });

  it("setBudget(null) clears the budget", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ limitUsd: null, spentUsd: 0, remainingUsd: null, pct: null, state: "unset" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await usageApi.setBudget(null);

    expect(fetchMock).toHaveBeenCalledWith(
      `${BASE}/usage/budget`,
      expect.objectContaining({ body: JSON.stringify({ limitUsd: null }) })
    );
  });

  it("throws with the response body text when the request fails", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => "Budget must be zero or a positive USD amount.",
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(usageApi.setBudget(-5)).rejects.toThrow("Budget must be zero or a positive USD amount.");
  });
});

describe("formatCost", () => {
  it("re-exports a pure formatter that reads local models as free, not $0.00", async () => {
    const { formatCost } = await import("./usageApi");
    expect(formatCost(0, true)).toBe("free");
    expect(formatCost(0, false)).toBe("cost unknown");
    expect(formatCost(1.5, false)).toBe("$1.50");
    expect(formatCost(0.0009, false)).toBe("$0.001");
  });
});
