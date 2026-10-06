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
it("names the model the node will run, and only flags a missing model when neither node nor connection has one (F7/F8)", () => {
 const base = useProviderStore.getState().connections.find((c) => c.id === "ollama-local")!;
 const ollama = { ...base, id: "ol", label: "Ollama local", enabled: true, health: "live" as const, defaultModel: "" };
 expect(nodeProviderSummary({ label: "Agent", providerIds: ["ol"] }, "live", [ollama])).toBe("Ollama local · No model chosen");
 expect(nodeProviderSummary({ label: "Agent", providerIds: ["ol"], model: "qwen3:8b" }, "live", [ollama])).toBe("Ollama local · qwen3:8b · Verified");
 expect(nodeProviderSummary({ label: "Agent", providerIds: ["ol"] }, "live", [{ ...ollama, defaultModel: "gemma4:26b" }])).toBe("Ollama local · gemma4:26b · Verified");
});
