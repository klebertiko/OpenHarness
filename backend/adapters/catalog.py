"""Provider catalogue — authoritative vendor specs for the sidecar.

Mirrors ``frontend/src/components/providers/catalog.ts``. Keep the two in step;
this module is authoritative at runtime. The frontend copy exists so the UI can
render a provider the user has not connected yet (and so the dev route runs
with no backend).
"""

from __future__ import annotations

from typing import Literal, TypedDict

ProviderId = Literal["anthropic", "cursor", "openai", "ollama", "openrouter"]
Residence = Literal["local", "cloud"]
Capability = Literal["chat", "agent", "embed"]
Billing = Literal["subscription", "credits", "metered", "none"]
Catalogue = Literal["fixed", "installed", "hosted", "routed", "agent-only"]


class CredentialSpec(TypedDict, total=False):
    kind: Literal["api-key", "none"]
    prefix: str
    where: str
    env: str


class EndpointSpec(TypedDict):
    default: str
    editable: bool


class ProviderSpec(TypedDict, total=False):
    id: ProviderId
    vendor: str
    monogram: str
    residence: Residence | Literal["either"]
    capabilities: list[Capability]
    billing: Billing
    catalogue: Catalogue
    credential: CredentialSpec
    endpoint: EndpointSpec
    summary: str
    caveat: str
    docs: str


PROVIDERS: dict[ProviderId, ProviderSpec] = {
    "anthropic": {
        "id": "anthropic",
        "vendor": "Anthropic",
        "monogram": "AN",
        "residence": "cloud",
        "capabilities": ["chat"],
        "billing": "metered",
        "catalogue": "fixed",
        "credential": {
            "kind": "api-key",
            "prefix": "sk-ant-",
            "where": "console.anthropic.com → Settings → API keys",
            "env": "ANTHROPIC_API_KEY",
        },
        "endpoint": {"default": "https://api.anthropic.com", "editable": True},
        "summary": (
            "Claude models over the Messages API. "
            "Billed per token against the key's workspace."
        ),
        "docs": "https://docs.anthropic.com",
    },
    "cursor": {
        "id": "cursor",
        "vendor": "Cursor",
        "monogram": "CU",
        "residence": "cloud",
        "capabilities": ["agent"],
        "billing": "subscription",
        "catalogue": "agent-only",
        "credential": {
            "kind": "api-key",
            "prefix": "crsr_",
            "where": "cursor.com dashboard → API Keys (user key or service account)",
            "env": "CURSOR_API_KEY",
        },
        "endpoint": {"default": "https://api.cursor.com", "editable": False},
        "summary": (
            "Cloud Agents API and the headless cursor-agent CLI, "
            "both on your Cursor seat."
        ),
        "caveat": (
            "Cursor publishes no chat-completions endpoint — its API runs agents, "
            "not models. An LLM node cannot target this connection; a Delegate node can."
        ),
        "docs": "https://cursor.com/docs/api",
    },
    "openai": {
        "id": "openai",
        "vendor": "OpenAI",
        "monogram": "OA",
        "residence": "cloud",
        "capabilities": ["chat", "embed"],
        "billing": "metered",
        "catalogue": "fixed",
        "credential": {
            "kind": "api-key",
            "prefix": "sk-",
            "where": "platform.openai.com → API keys",
            "env": "OPENAI_API_KEY",
        },
        "endpoint": {"default": "https://api.openai.com/v1", "editable": True},
        "summary": (
            "GPT models over the Chat Completions API. "
            "Billed per token against the project."
        ),
        "docs": "https://platform.openai.com/docs",
    },
    "ollama": {
        "id": "ollama",
        "vendor": "Ollama",
        "monogram": "OL",
        "residence": "either",
        "capabilities": ["chat", "embed"],
        "billing": "none",
        "catalogue": "installed",
        "credential": {
            "kind": "none",
            "where": (
                "The local daemon is unauthenticated. "
                "Ollama Cloud is a separate connection."
            ),
            "env": "OLLAMA_API_KEY",
        },
        "endpoint": {"default": "http://127.0.0.1:11434", "editable": True},
        "summary": "The daemon on this machine. Nothing leaves the device; nothing is billed.",
        "docs": "https://docs.ollama.com",
    },
    "openrouter": {
        "id": "openrouter",
        "vendor": "OpenRouter",
        "monogram": "OR",
        "residence": "cloud",
        "capabilities": ["chat"],
        "billing": "credits",
        "catalogue": "routed",
        "credential": {
            "kind": "api-key",
            "prefix": "sk-or-",
            "where": "openrouter.ai → Keys",
            "env": "OPENROUTER_API_KEY",
        },
        "endpoint": {"default": "https://openrouter.ai/api/v1", "editable": False},
        "summary": (
            "One key, many vendors. You pick a route — an ordered model preference — "
            "not a model."
        ),
        "caveat": (
            "Prices and availability are set by the upstream vendor and move without "
            "notice. A route with no fallback will fail when its first choice is down."
        ),
        "docs": "https://openrouter.ai/docs",
    },
}

OLLAMA_CLOUD: ProviderSpec = {
    **PROVIDERS["ollama"],
    "residence": "cloud",
    "billing": "subscription",
    "catalogue": "hosted",
    "credential": {
        "kind": "api-key",
        "prefix": "",
        "where": "ollama.com → Settings → API keys (or run `ollama signin`)",
        "env": "OLLAMA_API_KEY",
    },
    "endpoint": {"default": "https://ollama.com", "editable": False},
    "summary": (
        "ollama.com as a remote host — same API surface, models too large for this machine."
    ),
    "caveat": (
        "A cloud model id looks identical to a local one. The residence stamp on the "
        "row is the only thing that tells you where the tokens were computed."
    ),
}


def list_catalog() -> list[ProviderSpec]:
    """Return every base vendor spec (Ollama Cloud is a residence variant, not a row)."""
    return [PROVIDERS[pid] for pid in ("anthropic", "cursor", "openai", "ollama", "openrouter")]


def get_provider(provider_id: str) -> ProviderSpec | None:
    if provider_id in PROVIDERS:
        return PROVIDERS[provider_id]  # type: ignore[index]
    return None
