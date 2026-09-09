/**
 * Provider catalogue — the single source of truth for what each vendor *is*.
 *
 * Mirrors `backend/adapters/catalog.py`. Keep the two in step; the backend is
 * authoritative at runtime, this copy exists so the UI can render a provider
 * the user has not connected yet (and so the dev route runs with no backend).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THREE AXES AND NOT A LOGO GRID
 *
 * A single-vendor tool shows you a list of integrations because every row means
 * the same thing. OpenHarness holds a *wallet*: five vendors, six connections,
 * and three properties that differ per row and change what a harness is allowed
 * to do with it.
 *
 *   residence  — does inference happen on this machine or leave it?
 *   capability — can a node call it for a completion, or only delegate a task?
 *   billing    — a seat you already pay for, prepaid credits, or per-token spend?
 *
 * Those are fixed columns in the ledger. You scan down one, not across six.
 * ─────────────────────────────────────────────────────────────────────────────
 */

export type ProviderId = "anthropic" | "cursor" | "openai" | "ollama" | "openrouter";

/** Where the tokens are actually computed. */
export type Residence = "local" | "cloud";

/**
 * What a connection can be asked to do.
 *  chat  — single-shot / streaming completion. An LLM node can target it.
 *  agent — a whole task is delegated to a vendor-run agent loop. An LLM node
 *          CANNOT target it; only a Delegate node can.
 */
export type Capability = "chat" | "agent" | "embed";

export type Billing = "subscription" | "credits" | "metered" | "none";

/** How models are chosen for this provider — drives the whole model section. */
export type Catalogue =
  | "fixed" /* short vendor-published list                       */
  | "installed" /* whatever the daemon has pulled locally        */
  | "hosted" /* whatever the vendor hosts right now              */
  | "routed" /* multi-vendor market: search + a fallback chain   */
  | "agent-only"; /* no model choice at node level               */

export type Health = "live" | "setup" | "degraded" | "fault" | "probing";

export interface CredentialSpec {
  /** `none` means this connection holds no secret at all. */
  kind: "api-key" | "none";
  /** Real, checkable prefix — used to catch a pasted key from the wrong vendor. */
  prefix?: string;
  /** Where the user gets one. Plain sentence, no marketing. */
  where: string;
  /** Environment variable the vendor's own tooling reads, for the CLI handoff. */
  env?: string;
}

export interface ProviderSpec {
  id: ProviderId;
  vendor: string;
  /** Two characters, mono, grey. Identity through form — hue is reserved for state. */
  monogram: string;
  /** `either` means the vendor is connected twice, once per residence. */
  residence: Residence | "either";
  capabilities: Capability[];
  billing: Billing;
  catalogue: Catalogue;
  credential: CredentialSpec;
  endpoint: { default: string; editable: boolean };
  /** One line, factual, present tense. Shown under the vendor name in the dossier. */
  summary: string;
  /** A constraint the user will otherwise discover the hard way. */
  caveat?: string;
  docs: string;
}

export const PROVIDERS: Record<ProviderId, ProviderSpec> = {
  anthropic: {
    id: "anthropic",
    vendor: "Anthropic",
    monogram: "AN",
    residence: "cloud",
    capabilities: ["chat"],
    billing: "metered",
    catalogue: "fixed",
    credential: {
      kind: "api-key",
      prefix: "sk-ant-",
      where: "console.anthropic.com → Settings → API keys",
      env: "ANTHROPIC_API_KEY",
    },
    endpoint: { default: "https://api.anthropic.com", editable: true },
    summary: "Claude models over the Messages API. Billed per token against the key's workspace.",
    docs: "https://docs.anthropic.com",
  },

  cursor: {
    id: "cursor",
    vendor: "Cursor",
    monogram: "CU",
    residence: "cloud",
    capabilities: ["agent"],
    billing: "subscription",
    catalogue: "agent-only",
    credential: {
      kind: "api-key",
      prefix: "crsr_",
      where: "cursor.com dashboard → API Keys (user key or service account)",
      env: "CURSOR_API_KEY",
    },
    endpoint: { default: "https://api.cursor.com", editable: false },
    summary:
      "Cloud Agents API and the headless cursor-agent CLI, both on your Cursor seat.",
    caveat:
      "Cursor publishes no chat-completions endpoint — its API runs agents, not models. An LLM node cannot target this connection; a Delegate node can.",
    docs: "https://cursor.com/docs/api",
  },

  openai: {
    id: "openai",
    vendor: "OpenAI",
    monogram: "OA",
    residence: "cloud",
    capabilities: ["chat", "embed"],
    billing: "metered",
    catalogue: "fixed",
    credential: {
      kind: "api-key",
      prefix: "sk-",
      where: "platform.openai.com → API keys",
      env: "OPENAI_API_KEY",
    },
    endpoint: { default: "https://api.openai.com/v1", editable: true },
    summary: "GPT models over the Chat Completions API. Billed per token against the project.",
    docs: "https://platform.openai.com/docs",
  },

  ollama: {
    id: "ollama",
    vendor: "Ollama",
    monogram: "OL",
    residence: "either",
    capabilities: ["chat", "embed"],
    billing: "none",
    catalogue: "installed",
    credential: {
      kind: "none",
      where: "The local daemon is unauthenticated. Ollama Cloud is a separate connection.",
      env: "OLLAMA_API_KEY",
    },
    endpoint: { default: "http://127.0.0.1:11434", editable: true },
    summary: "The daemon on this machine. Nothing leaves the device; nothing is billed.",
    docs: "https://docs.ollama.com",
  },

  openrouter: {
    id: "openrouter",
    vendor: "OpenRouter",
    monogram: "OR",
    residence: "cloud",
    capabilities: ["chat"],
    billing: "credits",
    catalogue: "routed",
    credential: {
      kind: "api-key",
      prefix: "sk-or-",
      where: "openrouter.ai → Keys",
      env: "OPENROUTER_API_KEY",
    },
    endpoint: { default: "https://openrouter.ai/api/v1", editable: false },
    summary:
      "One key, many vendors. You pick a route — an ordered model preference — not a model.",
    caveat:
      "Prices and availability are set by the upstream vendor and move without notice. A route with no fallback will fail when its first choice is down.",
    docs: "https://openrouter.ai/docs",
  },
};

/**
 * The Ollama split is the interesting case in this app, so it gets an explicit
 * override rather than a `variant` flag threaded through the whole UI. Local and
 * Cloud speak the same wire protocol and share an adapter; they differ in every
 * property a person actually cares about.
 */
export const OLLAMA_CLOUD: ProviderSpec = {
  ...PROVIDERS.ollama,
  residence: "cloud",
  billing: "subscription",
  catalogue: "hosted",
  credential: {
    kind: "api-key",
    prefix: "",
    where: "ollama.com → Settings → API keys (or run `ollama signin`)",
    env: "OLLAMA_API_KEY",
  },
  endpoint: { default: "https://ollama.com", editable: false },
  summary:
    "ollama.com as a remote host — same API surface, models too large for this machine.",
  caveat:
    "A cloud model id looks identical to a local one. The residence stamp on the row is the only thing that tells you where the tokens were computed.",
};

/* ── Label tables ─────────────────────────────────────────────────────────── */

export const RESIDENCE_LABEL: Record<Residence, string> = {
  local: "this machine",
  cloud: "vendor cloud",
};

export const CAPABILITY_LABEL: Record<Capability, string> = {
  chat: "completion",
  agent: "delegation",
  embed: "embedding",
};

export const BILLING_LABEL: Record<Billing, string> = {
  subscription: "seat",
  credits: "credits",
  metered: "per token",
  none: "free",
};

export const HEALTH_LABEL: Record<Health, string> = {
  live: "live",
  setup: "needs setup",
  degraded: "degraded",
  fault: "error",
  probing: "probing",
};

/** Health → the one CSS custom property that row is allowed to use. */
export const HEALTH_INK: Record<Health, string> = {
  live: "var(--signal)",
  setup: "var(--ink-faint)",
  degraded: "var(--warn)",
  fault: "var(--fault)",
  probing: "var(--ink-dim)",
};
