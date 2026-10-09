import { expect, it } from "vitest";
import { COPILOT_ENABLED } from "./features";

it("ships with the Studio Copilot entry enabled now that the runtime exists", () => {
  expect(COPILOT_ENABLED).toBe(true);
});
