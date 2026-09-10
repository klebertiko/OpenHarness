import { PROVIDERS_BIND_NONE, PROVIDERS_PANEL_TITLE } from "./copy";
import { expect, test } from "vitest";

test("panel title is Providers not Wallet", () => {
  expect(PROVIDERS_PANEL_TITLE).toBe("Providers");
  expect(PROVIDERS_PANEL_TITLE.toLowerCase()).not.toContain("wallet");
});

test("bind placeholder does not mention Wallet", () => {
  expect(PROVIDERS_BIND_NONE.toLowerCase()).not.toContain("wallet");
  expect(PROVIDERS_BIND_NONE).toContain("Providers");
});
