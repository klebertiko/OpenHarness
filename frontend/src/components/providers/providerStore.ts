"use client";
import { create } from "zustand";
import {
  PROVIDERS,
  OLLAMA_CLOUD,
  type Catalogue,
  type Health,
  type ProviderId,
  type ProviderSpec,
  type Residence,
} from "./catalog";
import { activeVault, forgetSecret, saveSecret, type SecretRef } from "./secrets";
import { apiUrl } from "@/lib/apiBase";

/* ── Shapes ───────────────────────────────────────────────────────────────── */

export interface Probe {
  /** Round-trip of the last reachability check, in ms. */
  ms: number;
  ok: boolean;
}

export interface ModelInfo {
  id: string;
  /** Context window in tokens. */
  ctx: number;
  /** USD per million tokens, in/out. Null where the provider does not bill. */
  price?: [number, number];
  /** Upstream vendor — only meaningful on a routed provider. */
  via?: string;
  /** Local models report their on-disk size. */
  size?: string;
}

/** A fact the probe learned about the account behind the credential. */
export interface AccountFact {
  k: string;
  v: string;
  tone?: "dim" | "signal" | "warn" | "fault";
}

export interface Connection {
  id: string;
  provider: ProviderId;
  label: string;
  residence: Residence;
  endpoint: string;
  secret: SecretRef | null;
  health: Health;
  /** One sentence a person can act on. Never a raw stack trace. */
  detail: string;
  probes: Probe[];
  facts: AccountFact[];
  models: ModelInfo[];
  /** Routed providers only: the ordered preference the harness sends. */
  route: string[];
  routeSort: "price" | "throughput" | "latency";
  /** Which models a non-routed provider is allowed to serve. */
  allowed: string[];
  enabled: boolean;
  lastProbe: string;
}

export function specOf(c: Connection): ProviderSpec {
  if (c.provider === "ollama") return c.residence === "cloud" ? OLLAMA_CLOUD : PROVIDERS.ollama;
  return PROVIDERS[c.provider];
}

export function catalogueOf(c: Connection): Catalogue {
  return specOf(c).catalogue;
}

/* ── Catalog template ─────────────────────────────────────────────────────────
   Six connections across five vendors. `models`/`endpoint`/`residence` below
   are static vendor facts — safe to show before anything is connected. Every
   *status* field (health, detail, facts, secret, enabled) is neutralised by
   `offlineTemplate()` below and only becomes real once `hydrate()` merges in
   what the backend actually knows, or a probe/secret round-trip updates it. */

const now = new Date("2026-09-04T11:42:00Z").toISOString();

const seed: Connection[] = [
  {
    id: "anthropic",
    provider: "anthropic",
    label: "Anthropic",
    residence: "cloud",
    endpoint: "https://api.anthropic.com",
    secret: null,
    health: "live",
    detail: "Logged in as klebertiko@gmail.com (pro plan). 4 models offered on this seat.",
    probes: [188, 204, 191, 176, 199, 212, 183, 195, 180, 207, 190, 186],
    facts: [
      { k: "account", v: "klebertiko@gmail.com" },
      { k: "plan", v: "pro", tone: "signal" },
      { k: "cli", v: "claude · on PATH", tone: "signal" },
    ],
    models: [
      { id: "claude-opus-5", ctx: 200000, price: [15, 75] },
      { id: "claude-sonnet-5", ctx: 200000, price: [3, 15] },
      { id: "claude-fable-5-1", ctx: 200000, price: [1, 5] },
      { id: "claude-haiku-4-5", ctx: 200000, price: [0.8, 4] },
    ],
    route: [],
    routeSort: "price",
    allowed: ["claude-opus-5", "claude-sonnet-5", "claude-fable-5-1"],
    enabled: true,
    lastProbe: now,
  } as unknown as Connection,

  {
    id: "cursor",
    provider: "cursor",
    label: "Cursor",
    residence: "cloud",
    endpoint: "https://api.cursor.com",
    secret: null,
    health: "live",
    detail: "Logged in as klebertiko@gmail.com. Delegation only — no completion endpoint exists.",
    probes: [246, 231, 259, 240, 268, 252, 238, 244, 271, 249, 235, 257],
    facts: [
      { k: "account", v: "klebertiko@gmail.com" },
      { k: "cli", v: "cursor-agent · on PATH", tone: "signal" },
    ],
    models: [
      { id: "cursor-composer-2-5", ctx: 200000 },
      { id: "claude-opus-5", ctx: 200000 },
      { id: "gpt-5-6-sol", ctx: 400000 },
    ],
    route: [],
    routeSort: "price",
    allowed: [],
    enabled: true,
    lastProbe: now,
  } as unknown as Connection,

  {
    id: "openai",
    provider: "openai",
    label: "OpenAI",
    residence: "cloud",
    endpoint: "https://api.openai.com/v1",
    secret: {
      service: "openharness/openai",
      prefix: "sk-proj-",
      tail: "0aT7",
      length: 164,
      vault: "os-keychain",
      savedAt: "2026-06-02T08:05:00Z",
    },
    health: "fault",
    detail:
      "401 invalid_api_key — the key was revoked or belongs to a deleted project. Replace it to continue.",
    probes: [141, 137, 149, 144, 0, 0, 0, 0, 0, 0, 0, 0],
    facts: [
      { k: "http", v: "401 invalid_api_key", tone: "fault" },
      { k: "first failed", v: "2026-09-01 07:14" },
      { k: "failed since", v: "8 consecutive probes", tone: "fault" },
    ],
    models: [],
    route: [],
    routeSort: "price",
    allowed: [],
    enabled: true,
    lastProbe: now,
  } as unknown as Connection,

  {
    id: "ollama-local",
    provider: "ollama",
    label: "Ollama local",
    residence: "local",
    endpoint: "http://127.0.0.1:11434",
    secret: null,
    health: "live",
    detail: "Daemon answering. 5 models pulled, 41.2 GB on disk.",
    probes: [4, 3, 5, 4, 6, 3, 4, 4, 7, 4, 3, 5],
    facts: [
      { k: "version", v: "0.12.6" },
      { k: "runner", v: "cuda · 24 GB vram" },
      { k: "egress", v: "none — stays on device", tone: "signal" },
    ],
    models: [
      { id: "qwen3.5:9b", ctx: 128000, size: "6.1 GB" },
      { id: "gpt-oss:20b", ctx: 131072, size: "13.8 GB" },
      { id: "llama4.2:11b", ctx: 128000, size: "7.4 GB" },
      { id: "nomic-embed-text", ctx: 8192, size: "274 MB" },
      { id: "deepseek-r2:14b", ctx: 160000, size: "13.6 GB" },
    ],
    route: [],
    routeSort: "price",
    allowed: ["qwen3.5:9b", "gpt-oss:20b", "deepseek-r2:14b"],
    enabled: true,
    lastProbe: now,
  } as unknown as Connection,

  {
    id: "ollama-cloud",
    provider: "ollama",
    label: "Ollama Cloud",
    residence: "cloud",
    endpoint: "https://ollama.com",
    secret: null,
    health: "setup",
    detail: "No credential yet. Add a key from ollama.com, or run `ollama signin` and import it.",
    probes: [],
    facts: [],
    models: [],
    route: [],
    routeSort: "price",
    allowed: [],
    enabled: false,
    lastProbe: "",
  } as unknown as Connection,

  {
    id: "openrouter",
    provider: "openrouter",
    label: "OpenRouter",
    residence: "cloud",
    endpoint: "https://openrouter.ai/api/v1",
    secret: {
      service: "openharness/openrouter",
      prefix: "sk-or-",
      tail: "c07e",
      length: 73,
      vault: "os-keychain",
      savedAt: "2026-07-30T21:18:00Z",
    },
    health: "degraded",
    detail: "$1.84 of credits left. Runs will start failing mid-graph once it hits zero.",
    probes: [312, 298, 341, 305, 288, 366, 299, 402, 317, 294, 355, 308],
    facts: [
      { k: "label", v: "openharness" },
      { k: "credits", v: "$1.84 of $25.00", tone: "warn" },
      { k: "spent 30d", v: "$23.16" },
      { k: "free tier", v: "no" },
    ],
    models: [
      { id: "anthropic/claude-opus-5", ctx: 200000, price: [15, 75], via: "Anthropic" },
      { id: "openai/gpt-5-6-sol", ctx: 400000, price: [10, 40], via: "OpenAI" },
      { id: "google/gemini-3-1-pro", ctx: 2000000, price: [2.5, 12], via: "Google" },
      { id: "deepseek/deepseek-v4", ctx: 164000, price: [0.28, 1.1], via: "DeepSeek" },
      { id: "meta-llama/llama-4.2-405b", ctx: 128000, price: [0.9, 0.9], via: "Together" },
      { id: "qwen/qwen3.5-max", ctx: 262144, price: [1.2, 6], via: "Alibaba" },
      { id: "mistralai/mistral-large-3", ctx: 128000, price: [2, 6], via: "Mistral" },
      { id: "x-ai/grok-4-6", ctx: 256000, price: [5, 15], via: "xAI" },
    ],
    route: ["anthropic/claude-opus-5", "openai/gpt-5-6-sol", "deepseek/deepseek-v4"],
    routeSort: "price",
    allowed: [],
    enabled: true,
    lastProbe: now,
  } as unknown as Connection,
];

function credentialDetail(c: Connection): string {
  const cred = specOf(c).credential;
  if (cred.kind === "cli") return `Not connected. ${cred.where}`;
  if (cred.kind === "none") return "Not connected. Nothing to add — turn it on when ready.";
  return `Not connected. Add a key from ${cred.where}.`;
}

/** Every status field neutralised to "nothing has happened yet". Vendor facts
    (models, endpoint, residence) survive from the template as-is. */
function offlineTemplate(c: Connection): Connection {
  return {
    ...c,
    secret: null,
    health: "setup",
    detail: credentialDetail(c),
    probes: [],
    facts: [],
    enabled: false,
    lastProbe: "",
  };
}

type BackendConnectionRow = {
  id: string;
  provider: string;
  label: string;
  residence: Residence;
  endpoint: string;
  enabled: boolean;
  secretRef: string | null;
};

/** Create-if-missing so /probe and /secret never 404 on a connection this
    session hasn't POSTed yet. 409 (already exists) is success. */
async function ensureBackendRow(c: Connection): Promise<void> {
  try {
    await fetch(apiUrl("/providers/connections"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: c.id,
        provider: c.provider,
        label: c.label,
        residence: c.residence,
        endpoint: c.endpoint,
        enabled: false,
      }),
    });
  } catch {
    // Surfaced by the probe/secret call that follows.
  }
}

type ProbeResponse = {
  ok: boolean;
  health: Health;
  detail: string;
  latencyMs: number;
  facts: AccountFact[];
};

/** The one real reachability check — no fixture, no fake delay. */
async function runProbe(id: string, set: (partial: Partial<ProviderState>) => void, get: () => ProviderState) {
  try {
    const res = await fetch(apiUrl(`/providers/${encodeURIComponent(id)}/probe`), { method: "POST" });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      throw new Error((body?.detail as string) || `Test failed (HTTP ${res.status}).`);
    }
    const body = (await res.json()) as ProbeResponse;
    set({
      connections: patch(get().connections, id, (c) => ({
        ...c,
        health: body.health,
        detail: body.detail,
        facts: body.facts,
        probes: [...c.probes.slice(-11), { ms: body.latencyMs, ok: body.ok }],
        lastProbe: new Date().toISOString(),
      })),
    });
  } catch (err) {
    set({
      connections: patch(get().connections, id, (c) => ({
        ...c,
        health: "fault",
        detail:
          err instanceof Error
            ? err.message
            : "Could not reach the OpenHarness sidecar to test this connection.",
        probes: [...c.probes.slice(-11), { ms: 0, ok: false }],
        lastProbe: new Date().toISOString(),
      })),
    });
  }
}

/** Auth/transport signatures a real adapter call actually fails with — the
    same class runProbe()'s own catch block treats as fault. Deliberately
    narrow: a resolver-side config problem ("disconnected", "no credential",
    "no default model", a capability mismatch) is a graph/setup issue, not
    proof the vendor rejected a call, so those messages are left out on
    purpose — flipping a connection to "fault" over a miswired node would be
    exactly the "misread as broken" mistake this exists to avoid. An
    unmatched message leaves health untouched rather than guessing. */
const PROVIDER_FAILURE_SIGNATURES = [
  "401",
  "403",
  "unauthorized",
  "invalid api key",
  "invalid_api_key",
  "authentication failed",
  "not logged in",
  "econnrefused",
  "connection refused",
  "enotfound",
  "timed out",
  "timeout",
] as const;

/** Is this run-failure message real evidence the *connection* is broken —
    not a bad prompt, a tool error, or a graph miswiring?
    NOT currently called by `useRunStream` — 2026-09-13 SEC review found the
    only source of `Segment.error` text is free-form prose (a model's own
    output when an adapter reports `is_error`, a human reviewer's HITL
    rejection note, or an engine-composed token-limit message that embeds
    the node's label and raw numbers), and every one of those can contain a
    substring on this list by coincidence or by design — a prompt someone
    pasted, a reviewer's phrasing, a token count like "4013" all match. A
    stale "live" from that gap self-corrects on the next real attempt; a
    false "fault" does not (`fault` blocks the connection from being picked
    again — `chatProvider.ts`'s `pickChatProvider`/`autoPick` — until a
    person manually clicks Test), so an unsafe false positive here is worse
    than the bug this module fixes. Kept as a tested primitive for a future
    story that adds a structured, non-prose error classification on the
    wire (e.g. an `error_kind` field distinguishing auth/transport failures
    from content/HITL/limit errors) — do not wire this to a run outcome
    without one. */
export function isProviderLevelFailure(message: string): boolean {
  const m = message.toLowerCase();
  return PROVIDER_FAILURE_SIGNATURES.some((needle) => m.includes(needle));
}

/* ── Store ────────────────────────────────────────────────────────────────── */

interface ProviderState {
  connections: Connection[];
  selectedId: string;
  /** Which connections the harness in the editor is bound to, in order. */
  binding: string[];
  /** Ledger filter — the honest default is "everything", not "healthy only". */
  query: string;
  hydrated: boolean;

  select: (id: string) => void;
  setQuery: (q: string) => void;
  /** Merge real backend connection state over the catalog template. Safe to
      call more than once — it's a no-op after the first successful run. */
  hydrate: () => Promise<void>;
  probe: (id: string) => Promise<void>;
  /** A real run just finished against this connection — not a Test click,
      but the thing a person actually cares about working. `ok: true` is at
      least as strong evidence as a probe, so it clears the untested
      "setup" default the same way `runProbe()` would. `ok: false` must
      already be a caller-confirmed provider-level failure (see
      `isProviderLevelFailure`'s doc comment for why no caller uses it yet)
      — never a bad prompt, an HITL rejection, or a Stop. */
  reportRunOutcome: (id: string, outcome: { ok: true } | { ok: false; detail: string }) => void;
  attachSecret: (id: string, plaintext: string) => Promise<void>;
  revokeSecret: (id: string) => Promise<void>;
  setEndpoint: (id: string, endpoint: string) => void;
  toggleEnabled: (id: string) => Promise<void>;
  toggleAllowed: (id: string, model: string) => void;
  setRouteSort: (id: string, s: Connection["routeSort"]) => void;
  addToRoute: (id: string, model: string) => void;
  removeFromRoute: (id: string, model: string) => void;
  moveInRoute: (id: string, model: string, dir: -1 | 1) => void;
  bindToggle: (id: string) => void;
  bindMove: (id: string, dir: -1 | 1) => void;
}

const patch = (list: Connection[], id: string, f: (c: Connection) => Connection) =>
  list.map((c) => (c.id === id ? f(c) : c));

export const useProviderStore = create<ProviderState>((set, get) => ({
  connections: seed.map(offlineTemplate),
  selectedId: "openrouter",
  binding: ["anthropic", "ollama-local"],
  query: "",
  hydrated: false,

  select: (selectedId) => set({ selectedId }),
  setQuery: (query) => set({ query }),

  hydrate: async () => {
    if (get().hydrated) return;
    set({ hydrated: true }); // claim it before the await — one hydrate in flight, not one per mounted consumer
    try {
      const res = await fetch(apiUrl("/providers/connections"));
      if (!res.ok) return;
      const body = (await res.json()) as { connections: BackendConnectionRow[] };
      const byId = new Map(body.connections.map((row) => [row.id, row]));
      set({
        connections: get().connections.map((c) => {
          const row = byId.get(c.id);
          if (!row) return c;
          return {
            ...c,
            label: row.label,
            residence: row.residence,
            endpoint: row.endpoint,
            enabled: row.enabled,
            secret: row.secretRef
              ? {
                  service: row.secretRef,
                  prefix: "",
                  tail: "····",
                  length: 0,
                  vault: activeVault(),
                  savedAt: "",
                }
              : null,
          };
        }),
      });
    } catch {
      // Sidecar unreachable at mount — connections stay in the honest
      // "not connected" state from offlineTemplate() rather than lying live.
    }
  },

  /** Real reachability check against the sidecar — never a fixture replay. */
  probe: async (id) => {
    const before = get().connections.find((c) => c.id === id);
    if (!before) return;
    set({ connections: patch(get().connections, id, (c) => ({ ...c, health: "probing" })) });
    await ensureBackendRow(before);
    await runProbe(id, set, get);
  },

  reportRunOutcome: (id, outcome) => {
    const c = get().connections.find((x) => x.id === id);
    // A disabled connection is fully out of the loop until a person
    // re-enables it — a stray or racing run outcome must not move its
    // health either direction (that would resurrect, or newly break, a
    // connection they've already turned away from). A probe already in
    // flight owns the next honest answer. An unknown id is a stray event.
    if (!c || !c.enabled || c.health === "probing") return;
    if (outcome.ok) {
      set({
        connections: patch(get().connections, id, (x) => ({
          ...x,
          health: "live",
          detail: x.health === "live" ? x.detail : "Verified by a real run just now.",
        })),
      });
    } else {
      set({
        connections: patch(get().connections, id, (x) => ({ ...x, health: "fault", detail: outcome.detail })),
      });
    }
  },

  /** The plaintext lives inside this call and nowhere else. `saveSecret`
      already creates the backend connection row and, for the backend vault,
      flips it `enabled` server-side — the probe right after is what tells us
      whether the key actually works, not a timer. */
  attachSecret: async (id, plaintext) => {
    const c = get().connections.find((x) => x.id === id);
    if (!c) return;
    const ref = await saveSecret(`openharness/${id}`, plaintext);
    set({
      connections: patch(get().connections, id, (x) => ({
        ...x,
        secret: ref,
        enabled: true,
        health: "probing",
        detail: "Credential stored. Verifying with the vendor…",
      })),
    });
    await runProbe(id, set, get);
  },

  /** Clears the local reference and, where the OS keychain holds it, the
      real credential. NOTE: for the backend-vault dev path there is no
      DELETE-just-the-secret route yet — the key stays in the sidecar's
      SecretsStore until the whole connection is deleted. Disabling here at
      least stops it from being picked for a run. */
  revokeSecret: async (id) => {
    await forgetSecret(`openharness/${id}`);
    set({
      connections: patch(get().connections, id, (c) => ({
        ...c,
        secret: null,
        health: "setup",
        enabled: false,
        detail: "Credential removed. This connection is offline until you add one.",
        facts: [],
      })),
      binding: get().binding.filter((b) => b !== id),
    });
    try {
      await fetch(apiUrl(`/providers/connections/${encodeURIComponent(id)}`), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: false }),
      });
    } catch {
      // Best effort — resolve_node_provider still refuses a disabled
      // connection locally the next time a graph tries to use it.
    }
  },

  setEndpoint: (id, endpoint) =>
    set({ connections: patch(get().connections, id, (c) => ({ ...c, endpoint })) }),

  toggleEnabled: async (id) => {
    const c = get().connections.find((x) => x.id === id);
    if (!c) return;
    const enabled = !c.enabled;
    set({ connections: patch(get().connections, id, (x) => ({ ...x, enabled })) });
    await ensureBackendRow(c);
    try {
      await fetch(apiUrl(`/providers/connections/${encodeURIComponent(id)}`), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
    } catch {
      // Best effort — a probe or chat send will surface a stale toggle honestly.
    }
  },

  toggleAllowed: (id, model) =>
    set({
      connections: patch(get().connections, id, (c) => ({
        ...c,
        allowed: c.allowed.includes(model)
          ? c.allowed.filter((m) => m !== model)
          : [...c.allowed, model],
      })),
    }),

  setRouteSort: (id, routeSort) =>
    set({ connections: patch(get().connections, id, (c) => ({ ...c, routeSort })) }),

  addToRoute: (id, model) =>
    set({
      connections: patch(get().connections, id, (c) =>
        c.route.includes(model) ? c : { ...c, route: [...c.route, model] }
      ),
    }),

  removeFromRoute: (id, model) =>
    set({
      connections: patch(get().connections, id, (c) => ({
        ...c,
        route: c.route.filter((m) => m !== model),
      })),
    }),

  moveInRoute: (id, model, dir) =>
    set({
      connections: patch(get().connections, id, (c) => {
        const i = c.route.indexOf(model);
        const j = i + dir;
        if (i < 0 || j < 0 || j >= c.route.length) return c;
        const route = [...c.route];
        [route[i], route[j]] = [route[j], route[i]];
        return { ...c, route };
      }),
    }),

  bindToggle: (id) =>
    set({
      binding: get().binding.includes(id)
        ? get().binding.filter((b) => b !== id)
        : [...get().binding, id],
    }),

  bindMove: (id, dir) =>
    set(() => {
      const b = [...get().binding];
      const i = b.indexOf(id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= b.length) return {};
      [b[i], b[j]] = [b[j], b[i]];
      return { binding: b };
    }),
}));
