import { specOf, type Connection } from "@/components/providers/providerStore";

export type ChatProvider = {
  /** The real connection id this resolves to, whether picked or Auto — the
      harness graph needs a concrete id to fall back to per unpinned node
      (see backend/providers/resolution.py); "Auto" is a display choice, not
      an absence of one. */
  id: string;
  /** Human name shown next to the composer. */
  label: string;
  /** How the run reaches it — never "mock". Cloud → live, on-device → local. */
  mode: "live" | "local";
  /** True when this came from the person's pick, not the Auto fallback. */
  chosen: boolean;
};

/** Six real states a connection can be in, each earning its own visual tone.
    Deliberately keeps "a credential that was tried and rejected" (failing)
    distinct from "nobody has configured or turned this on yet"
    (unconfigured) — collapsing those two into one undifferentiated word was
    the exact bug this type exists to fix. */
export type ChatProviderTone = "verified" | "unverified" | "checking" | "attention" | "failing" | "unconfigured";

/** The one place that decides whether a connection is connected. Every surface
    (Providers list + dossier + credential seal, the chat picker, Studio node
    summaries) reads this instead of mixing `enabled` / `health` / `secret` on
    its own - two surfaces reading different fields is how a provider could
    read "connected" in one panel and sit under "Needs setup" in the other.

    `enabled` is the backend's own authority on usable (the gate
    resolve_node_provider() applies to a run), so it alone decides `ready`;
    health is evidence layered on top and can only *remove* readiness
    (`fault`) or add `verified`. A passing probe on a turned-off connection is
    therefore never "connected". */
export type ProviderReadiness = {
  /** ready = can answer a run now · off = has what it needs but is switched
      off · needs-setup = nothing configured yet · fault = a probe failed. */
  state: "ready" | "needs-setup" | "off" | "fault";
  /** Eligible to answer a run (enabled and not faulted). */
  ready: boolean;
  /** Ready AND the last probe said live/degraded. */
  verified: boolean;
  /** Status word (same strings `rowStatus` always returned). */
  label: string;
  tone: ChatProviderTone;
  /** What the person still has to do, or null when nothing. */
  missing: "credential" | "turn-on" | "fix-failure" | null;
};

export function providerReadiness(c: Connection): ProviderReadiness {
  const label = rowStatus(c);
  const tone = rowTone(c);
  if (c.health === "fault") {
    return { state: "fault", ready: false, verified: false, label, tone, missing: "fix-failure" };
  }
  if (!c.enabled) {
    const needsKey = specOf(c).credential.kind === "api-key" && !c.secret;
    return {
      state: needsKey ? "needs-setup" : "off",
      ready: false,
      verified: false,
      label,
      tone,
      missing: needsKey ? "credential" : "turn-on",
    };
  }
  return {
    state: "ready",
    ready: true,
    verified: c.health === "live" || c.health === "degraded",
    label,
    tone,
    missing: null,
  };
}

const modeOf = (c: Connection): "live" | "local" => (c.residence === "cloud" ? "live" : "local");

/** The first connection ready to answer: a live cloud one wins, else a live
    local one. `enabled` is the backend's own authority on usable — the same
    gate resolve_node_provider() checks for a run — not "live", which is only
    ever set by a Test click this browser session happened to make. Requiring
    "live" would force a fresh reload to look disconnected until re-tested. */
function autoPick(connections: Connection[]): Connection | null {
  const ready = connections.filter((c) => providerReadiness(c).ready);
  return ready.find((c) => c.residence === "cloud") ?? ready.find((c) => c.residence === "local") ?? null;
}

/**
 * Chat is always a real conversation — never a mock. It runs against the
 * provider the person picked in the composer chip (`chosenId`). Only Auto
 * resolves another connection. An unavailable explicit choice returns null,
 * preserving the person's routing decision. The composer then asks
 * the person to connect one instead of faking an answer.
 */
export function pickChatProvider(connections: Connection[], chosenId?: string | null): ChatProvider | null {
  if (chosenId) {
    const c = connections.find((x) => x.id === chosenId && providerReadiness(x).ready);
    if (c) return { id: c.id, label: c.label, mode: modeOf(c), chosen: true };
    return null;
  }
  const auto = autoPick(connections);
  return auto ? { id: auto.id, label: auto.label, mode: modeOf(auto), chosen: false } : null;
}


/** Probe evidence is distinct from enabled eligibility and the person's choice. */
export function chatProviderStatus(connection: Connection): string {
  if (!connection.enabled || connection.health === "fault") return "Unavailable";
  switch (connection.health) {
    case "live": return "Verified";
    case "probing": return "Checking connection";
    case "degraded": return "Needs attention";
    case "setup": return "Not verified";
  }
}

/** The row-level leading word. `chatProviderStatus` above stays untouched
    (piece 1's trigger chip already pins its 5 return strings) — this adds
    the one new distinction the dropdown needs: a real fault always outranks
    "not enabled" as more specific evidence (a credential WAS tried and
    rejected, not merely left off), so only a non-fault, disabled connection
    reads as "Not connected" instead of "Unavailable". Exported: the
    Providers screen (`ProvidersList.tsx`, `Dossier.tsx`) reads the same
    function so a connection never wears two different status words
    depending which surface you're looking at it from. */
export function rowStatus(connection: Connection): string {
  if (!connection.enabled && connection.health !== "fault") return "Not connected";
  return chatProviderStatus(connection);
}

/** Same priority as `rowStatus`, expressed as a tone for the row's dot. */
export function rowTone(connection: Connection): ChatProviderTone {
  if (connection.health === "fault") return "failing";
  if (!connection.enabled) return "unconfigured";
  switch (connection.health) {
    case "live": return "verified";
    case "probing": return "checking";
    case "degraded": return "attention";
    case "setup": return "unverified";
  }
}

/** What the composer tells the person when `pickChatProvider` came back null —
    never a bare "Unavailable" (design.md § Provider stance). Returns null
    once a provider actually resolves, so a caller can render this in place
    of the send affordance without a separate `!provider` check drifting out
    of sync. Credential shape comes from the catalog (`specOf`), not a
    hardcoded vendor list, so a future provider gets the right verb for free:
    `api-key` → paste a key, anything else (`cli` session or `none`) → an
    on/off switch, nothing to type. `id` is the connection this action would
    expand inline setup for — null when there is nothing concrete to expand
    (nothing chosen, or an explicit choice that no longer exists), in which
    case the caller should just open the combo. */
export function missingProviderAction(
  connections: Connection[],
  chosenId?: string | null,
): { text: string; id: string | null } | null {
  if (pickChatProvider(connections, chosenId)) return null;
  const target = chosenId ? connections.find((c) => c.id === chosenId) : null;
  if (!target) {
    return { text: chosenId ? "Pick a provider to send" : "Connect a provider to send", id: null };
  }
  const spec = specOf(target);
  const article = /^[aeiou]/i.test(spec.vendor) ? "an" : "a";
  const verb =
    spec.credential.kind === "api-key" ? `Paste ${article} ${spec.vendor} key` : `Turn on ${target.label}`;
  return { text: `${verb} to send`, id: target.id };
}

/** Auto names its resolved connection; every other row states its own evidence. */
export function chatProviderOptions(connections: Connection[]) {
  const auto = autoPick(connections);
  return [
    {
      id: null as string | null,
      label: "Auto",
      detail: auto ? "Uses " + auto.label + " · " + chatProviderStatus(auto) : "No available provider",
      ready: true,
      tone: auto ? rowTone(auto) : ("unconfigured" as ChatProviderTone),
    },
    ...connections.map((c) => ({
      id: c.id as string | null,
      label: c.label,
      detail: rowStatus(c) + " · " + (
        c.health === "fault" ? "Test failed" :
        c.residence === "cloud" ? "Cloud" : "On-device"
      ),
      ready: providerReadiness(c).ready,
      tone: rowTone(c),
    })),
  ];
}
