import { describe, expect, it } from "vitest";

import { defaultRepoProvider } from "./reposApi";

describe("defaultRepoProvider", () => {
  it("defaults to fake when env unset", () => {
    expect(defaultRepoProvider()).toBe("fake");
  });
});
