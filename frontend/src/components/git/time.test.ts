import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { formatRelativeTime } from "./time";

describe("formatRelativeTime", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-11T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns an em dash for empty/missing input", () => {
    expect(formatRelativeTime("")).toBe("—");
    expect(formatRelativeTime(null)).toBe("—");
    expect(formatRelativeTime(undefined)).toBe("—");
  });

  it("returns an em dash for an unparseable timestamp", () => {
    expect(formatRelativeTime("not-a-date")).toBe("—");
  });

  it("reports very recent timestamps as 'just now'", () => {
    expect(formatRelativeTime("2026-09-11T11:59:50Z")).toBe("just now");
  });

  it("reports minutes, hours, days and months at the right thresholds", () => {
    expect(formatRelativeTime("2026-09-11T11:55:00Z")).toBe("5m");
    expect(formatRelativeTime("2026-09-11T09:00:00Z")).toBe("3h");
    expect(formatRelativeTime("2026-09-08T12:00:00Z")).toBe("3d");
    expect(formatRelativeTime("2026-07-11T12:00:00Z")).toBe("2mo");
  });
});
