import { expect, it } from "vitest";
import { useProviderStore } from "@/components/providers/providerStore";
import { nodeProviderSummary } from "./nodeProvider";
it("simulation describes the execution mode without claiming a provider ran", () => {
 expect(nodeProviderSummary({ label: "Agent", providerIds: ["anthropic"] }, "mock", [])).toBe("Simulation · no provider called");
});
it("connected mode names the effective pin and its probe evidence, independent of legacy adapter", () => {
 const connection = { ...useProviderStore.getState().connections[0], id: "pinned", label: "Chosen connection", enabled: true, health: "setup" as const };
 expect(nodeProviderSummary({ label: "Agent", providerIds: ["pinned"], adapter: "mock" }, "live", [connection])).toBe("Chosen connection · Not verified");
});
it("missing pins are actionable and never pretend to use chat Auto", () => {
 expect(nodeProviderSummary({ label: "Agent" }, "live", [])).toBe("No connection pin · required in Studio");
 expect(nodeProviderSummary({ label: "Agent", providerIds: ["removed"] }, "local", [])).toBe("removed · Unavailable");
});
