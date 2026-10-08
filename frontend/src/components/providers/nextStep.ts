import { providerReadiness } from "@/components/agent/chatProvider";
import { specOf, type Connection } from "./providerStore";

/**
 * The one thing that would make a connection answer runs, phrased as an
 * action — the Providers screen's presentation of `providerReadiness().missing`
 * (design.md § Provider stance: "pick anything, fix it in place"). The list
 * row shows `hint`; the dossier header shows `label` as its single primary
 * button. Readiness itself is never re-derived here.
 *
 * Wording matches the chat composer's `missingProviderAction` ("Paste an
 * Anthropic key" / "Turn on X"), so the same connection asks for the same
 * fix on every surface. `hint` is the short form that fits after the status
 * word in a narrow list row. Null when nothing is missing.
 */
export type NextStep = {
  kind: "paste" | "turnOn" | "retest" | "model";
  label: string;
  hint: string;
};

export function nextStep(c: Connection): NextStep | null {
  switch (providerReadiness(c).missing) {
    case "credential": {
      const vendor = specOf(c).vendor;
      const article = /^[aeiou]/i.test(vendor) ? "an" : "a";
      return { kind: "paste", label: `Paste ${article} ${vendor} key`, hint: "add key" };
    }
    case "turn-on":
      return { kind: "turnOn", label: "Turn on", hint: "turn on" };
    case "model":
      return { kind: "model", label: "Choose a model", hint: "choose model" };
    case "fix-failure":
      return { kind: "retest", label: "Test again", hint: "retest" };
    default:
      return null;
  }
}
