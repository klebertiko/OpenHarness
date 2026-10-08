import { expect, it } from "vitest";
import { CopilotUnavailableError, startCopilotFromOverview } from "./copilotEntry";

it("is a documented placeholder that rejects until Copilot slice S3 wires it", async () => {
  await expect(startCopilotFromOverview("Research then review")).rejects.toBeInstanceOf(CopilotUnavailableError);
  await expect(startCopilotFromOverview("x")).rejects.toThrow("Copilot isn't available yet.");
});

it("refuses an empty description", async () => {
  await expect(startCopilotFromOverview("   ")).rejects.toThrow("Describe the harness first.");
});
