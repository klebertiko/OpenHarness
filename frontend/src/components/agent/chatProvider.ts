import type { Connection } from "@/components/providers/providerStore";

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

const modeOf = (c: Connection): "live" | "local" => (c.residence === "cloud" ? "live" : "local");

/** The first connection ready to answer: a live cloud one wins, else a live
    local one. `enabled` is the backend's own authority on usable — the same
    gate resolve_node_provider() checks for a run — not "live", which is only
    ever set by a Test click this browser session happened to make. Requiring
    "live" would force a fresh reload to look disconnected until re-tested. */
function autoPick(connections: Connection[]): Connection | null {
  const ready = connections.filter((c) => c.enabled && c.health !== "fault");
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
    const c = connections.find((x) => x.id === chosenId && x.enabled && x.health !== "fault");
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
    reads as "Not connected" instead of "Unavailable". */
function rowStatus(connection: Connection): string {
  if (!connection.enabled && connection.health !== "fault") return "Not connected";
  return chatProviderStatus(connection);
}

/** Same priority as `rowStatus`, expressed as a tone for the row's dot. */
function rowTone(connection: Connection): ChatProviderTone {
  if (connection.health === "fault") return "failing";
  if (!connection.enabled) return "unconfigured";
  switch (connection.health) {
    case "live": return "verified";
    case "probing": return "checking";
    case "degraded": return "attention";
    case "setup": return "unverified";
  }
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
      ready: c.enabled && c.health !== "fault",
      tone: rowTone(c),
    })),
  ];
}
