import { describe, expect, it } from "vitest";

import { effectiveHarnessEnabled } from "./automationsApi";

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
