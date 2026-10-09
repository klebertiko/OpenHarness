import { CopilotApiError } from "./api";

export interface Failure {
  text: string;
  link?: "providers";
}

/**
 * Error text for a person, always paired with a next action by the caller
 * (spec §3.2). Shared by the Copilot panel and field assist.
 */
export function describeFailure(err: unknown, kind: "plan" | "assist" = "plan"): Failure {
  if (err instanceof CopilotApiError) {
    const { error, detail } = err.body;
    if (err.status === 402) return { text: detail ?? "The monthly budget is used up.", link: "providers" };
    if (error === "plan_invalid") return { text: "Copilot's proposal didn't fit the graph rules" };
    if (error === "assist_invalid") return { text: "The suggestion didn't fit the field rules" };
    if (error === "payload_too_large") {
      return { text: kind === "plan" ? "This graph is too large for Copilot (60 blocks and 120 wires at most)." : "This text is too large to assist." };
    }
    if (error === "provider_timeout") return { text: detail ?? "The provider took too long to answer." };
    if (error === "provider_unavailable") return { text: detail ?? "No provider is ready. Connect one in Providers." };
    if (error === "provider_error") return { text: detail ?? "The provider returned an error." };
    return { text: detail ?? `Copilot couldn't answer (${error}).` };
  }
  return { text: "Couldn't reach the app backend. Check that it is running." };
}
