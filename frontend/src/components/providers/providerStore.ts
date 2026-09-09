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
import { forgetSecret, saveSecret, type SecretRef } from "./secrets";

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

/* ── Seed state ───────────────────────────────────────────────────────────────
   Six connections across five vendors, in five different real states. The two
   Ollama rows are the point: same vendor, same wire protocol, opposite answers
   to "did my prompt leave this machine". */

const now = new Date("2026-09-04T11:42:00Z").toISOString();

const seed: Connection[] = [
  {
    id: "anthropic",
    provider: "anthropic",
    label: "Anthropic",
    residence: "cloud",
    endpoint: "https://api.anthropic.com",
    secret: {
      service: "openharness/anthropic",
      prefix: "sk-ant-",
      tail: "9Qd4",
      length: 108,
      vault: "os-keychain",
      savedAt: "2026-08-19T09:12:00Z",
    },
    health: "live",
    detail: "Key accepted. 4 models offered on this workspace.",
    probes: [188, 204, 191, 176, 199, 212, 183, 195, 180, 207, 190, 186],
    facts: [
      { k: "workspace", v: "personal" },
      { k: "tier", v: "build · tier 2" },
      { k: "rate", v: "1000 rpm · 450k tpm" },
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
    secret: {
      service: "openharness/cursor",
      prefix: "crsr_",
      tail: "b31f",
      length: 69,
      vault: "os-keychain",
      savedAt: "2026-08-22T16:40:00Z",
    },
    health: "live",
    detail: "Key accepted by /v1/me. Delegation only — no completion endpoint exists.",
    probes: [246, 231, 259, 240, 268, 252, 238, 244, 271, 249, 235, 257],
    facts: [
      { k: "key name", v: "openharness-desktop" },
      { k: "account", v: "klebertiko@gmail.com" },
      { k: "cli", v: "cursor-agent 2.4.1 · on PATH", tone: "signal" },
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

/* Probe fixtures are written as bare millisecond arrays above for legibility;
   widen them into the real shape here. A zero means the probe never answered. */
const connections: Connection[] = seed.map((c) => ({
  ...c,
  probes: (c.probes as unknown as number[]).map((ms) => ({ ms, ok: ms > 0 })),
}));

/* ── Store ────────────────────────────────────────────────────────────────── */

interface ProviderState {
  connections: Connection[];
  selectedId: string;
  /** Which connections the harness in the editor is bound to, in order. */
  binding: string[];
  /** Ledger filter — the honest default is "everything", not "healthy only". */
  query: string;

  select: (id: string) => void;
  setQuery: (q: string) => void;
  probe: (id: string) => Promise<void>;
  attachSecret: (id: string, plaintext: string) => Promise<void>;
  revokeSecret: (id: string) => Promise<void>;
  setEndpoint: (id: string, endpoint: string) => void;
  toggleEnabled: (id: string) => void;
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
  connections,
  selectedId: "openrouter",
  binding: ["anthropic", "ollama-local"],
  query: "",

  select: (selectedId) => set({ selectedId }),
  setQuery: (query) => set({ query }),

  /**
   * Reachability check. In the packaged app this is a host command so the
   * credential never leaves the vault; here it replays the fixture's own verdict
   * after a realistic delay, which is what makes the probing state visible.
   */
  probe: async (id) => {
    const before = get().connections.find((c) => c.id === id);
    if (!before) return;
    set({ connections: patch(get().connections, id, (c) => ({ ...c, health: "probing" })) });

    const ms = before.probes.length
      ? Math.round(before.probes.slice(-4).reduce((a, p) => a + p.ms, 0) / 4)
      : 0;
    await new Promise((r) => setTimeout(r, Math.min(900, 260 + ms)));

    set({
      connections: patch(get().connections, id, (c) => ({
        ...c,
        health: before.health,
        probes: [...c.probes.slice(-11), { ms, ok: ms > 0 }],
        lastProbe: new Date().toISOString(),
      })),
    });
  },

  /** The plaintext lives inside this call and nowhere else. */
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
    await new Promise((r) => setTimeout(r, 700));
    set({
      connections: patch(get().connections, id, (x) => ({
        ...x,
        health: "live",
        detail: "Key accepted.",
        probes: [...x.probes.slice(-11), { ms: 240, ok: true }],
        lastProbe: new Date().toISOString(),
      })),
    });
  },

  revokeSecret: async (id) => {
    await forgetSecret(`openharness/${id}`);
    set({
      connections: patch(get().connections, id, (c) => ({
        ...c,
        secret: null,
        health: "setup",
        enabled: false,
        detail: "Credential removed from the vault. This connection is offline until you add one.",
        facts: [],
      })),
      binding: get().binding.filter((b) => b !== id),
    });
  },

  setEndpoint: (id, endpoint) =>
    set({ connections: patch(get().connections, id, (c) => ({ ...c, endpoint })) }),

  toggleEnabled: (id) =>
    set({ connections: patch(get().connections, id, (c) => ({ ...c, enabled: !c.enabled })) }),

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
