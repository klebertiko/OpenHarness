"""
Effective-provider resolution for a graph node.

Precedence, per the harness's provider rule:

  1. Node override — `data["providerIds"][0]`. This module treats that id
     as already-effective: the frontend is the single writer of the field,
     and it fills the slot with either a genuine per-node pin (the author's
     deliberate choice) or the chat composer's currently-selected connection
     when the node carries no pin of its own. The backend never re-derives
     a chip fallback of its own — one id, one place that decided it.
  2. Honest error — no id, an id nothing recognises, a disabled connection,
     a missing/unreadable credential, or a provider whose catalog entry
     cannot serve this node type (e.g. Cursor, which is agent-only). Every
     one of these raises `ProviderResolutionError` instead of resolving to
     MockAdapter — a run must never swap in mock output silently.

`execution_mode == "mock"` never reaches this module: it is a separate,
explicit choice made in the composer's mode switch, not a fallback.
"""
from __future__ import annotations

from dataclasses import dataclass

from adapters import get_adapter
from adapters.base import AdapterConfig, AgentAdapter
from adapters.catalog import get_provider
from secret_store.base import SecretsStore

# connection.provider -> the adapters.get_adapter() key that actually talks to
# it. A provider absent here has no working chat adapter yet, so resolving it
# raises rather than silently landing on "mock" (the same string a bundle
# author might have used to *deliberately* request mock). Shared with
# routers/providers.py's /probe endpoint — same translation, same reason:
# get_adapter() is keyed by CLI/wire-protocol name, not by connection.provider.
ADAPTER_BY_PROVIDER: dict[str, str] = {
    "anthropic": "claude",
    "openai": "codex",  # ChatGPT subscription via the codex CLI, not a metered key
    "ollama": "ollama",
    "openrouter": "openrouter",
}

# The CLI adapters (claude/codex) fall back to their own default model when a
# node pins none. These HTTP adapters have no such default — Ollama's own
# OpenAI-compat surface 400s with "model is required" rather than picking one
# (confirmed live, 2026-09-11) — so an empty model here must fail loud with
# an actionable message instead of reaching the adapter and 400ing 9 times
# over, once per harness node, with a raw httpx error.
_HTTP_ADAPTERS_REQUIRE_MODEL = {"ollama", "openrouter", "openai"}


class ProviderResolutionError(Exception):
    """A node's effective provider cannot honestly run a turn right now."""


@dataclass(frozen=True, slots=True)
class ResolvedProvider:
    adapter_name: str
    adapter: AgentAdapter
    config: AdapterConfig
    connection_id: str
    connection_label: str


def resolve_node_provider(
    data: dict,
    node_type: str,
    label: str,
    *,
    connections: dict[str, dict] | None,
    secrets_store: SecretsStore | None,
    cwd: str | None = None,
) -> ResolvedProvider:
    connections = connections or {}

    provider_ids = data.get("providerIds") or []
    if not provider_ids or not provider_ids[0]:
        raise ProviderResolutionError(
            "No provider is set for this node. Pin one on the node, or pick one "
            "from the chat provider chip and connect it under Providers."
        )

    connection_id = str(provider_ids[0])
    connection = connections.get(connection_id)
    if not connection:
        raise ProviderResolutionError(
            f"Connection '{connection_id}' was not found. Open Providers to "
            "reconnect it or choose a different one."
        )

    conn_label = connection.get("label") or connection_id
    if not connection.get("enabled", False):
        raise ProviderResolutionError(
            f"'{conn_label}' is disconnected. Open Providers and enable it "
            "before running this harness."
        )

    provider_id = connection.get("provider", "")
    spec = get_provider(provider_id)
    if not spec:
        raise ProviderResolutionError(
            f"'{conn_label}' uses an unknown provider '{provider_id}'. Open "
            "Providers to fix the connection."
        )

    capabilities = spec.get("capabilities", [])
    if "chat" not in capabilities:
        caveat = spec.get("caveat", "")
        detail = f" {caveat}" if caveat else ""
        raise ProviderResolutionError(
            f"'{conn_label}' ({spec.get('vendor', provider_id)}) does not serve "
            f"chat turns, so a {node_type or 'llm'} node cannot target it.{detail}"
        )

    credential = spec.get("credential", {})
    api_key = ""
    if credential.get("kind") == "api-key":
        secret_ref = connection.get("secretRef")
        if not secret_ref:
            raise ProviderResolutionError(
                f"'{conn_label}' has no credential saved. Add one under Providers."
            )
        if secrets_store is None:
            raise ProviderResolutionError(
                f"The secrets vault is unavailable, so '{conn_label}'s credential "
                "cannot be read."
            )
        api_key = secrets_store.get(secret_ref) or ""
        if not api_key:
            raise ProviderResolutionError(
                f"The credential for '{conn_label}' could not be read from the "
                "vault. Re-add it under Providers."
            )

    adapter_name = ADAPTER_BY_PROVIDER.get(provider_id)
    if not adapter_name:
        raise ProviderResolutionError(
            f"'{conn_label}' ({spec.get('vendor', provider_id)}) has no working "
            "adapter yet."
        )

    endpoint = connection.get("endpoint") or spec.get("endpoint", {}).get("default", "")
    # A graph node rarely pins a model — model choice is meant to live on the
    # connection, not be authored per node. The CLI adapters (claude/codex)
    # tolerate that and fall back to their own default; an HTTP-based
    # connection (Ollama/OpenRouter/OpenAI-compatible) has no such default and
    # 400s with "model is required" if this stays empty — surfaced live
    # against a real Ollama daemon, 2026-09-11.
    model = data.get("model") or connection.get("defaultModel", "")
    if not model and adapter_name in _HTTP_ADAPTERS_REQUIRE_MODEL:
        raise ProviderResolutionError(
            f"'{conn_label}' has no default model set. Open Providers and pick "
            "one for this connection, or pin a model on the node."
        )

    config = AdapterConfig(
        adapter=adapter_name,
        model=model,
        endpoint=endpoint,
        api_key=api_key,
        system_prompt=data.get("systemPrompt", ""),
        temperature=float(data.get("temperature", 0.7)),
        max_tokens=int(data.get("maxTokens", 4096)),
        # `cwd`/`cwd_root` are the same value: the run's validated Cowork
        # project directory (routers/execution.py checks it against the
        # cowork_projects table before it ever gets here). A CLI adapter's
        # `cli_shared.resolve_cwd()` trusts `cwd_root` as containment, so
        # only a pre-validated path may ever reach it — never raw request
        # input. Omitted (not empty string) when no folder is chosen, so the
        # adapter falls back to its own app-owned scratch directory.
        extra=(
            {"node_type": node_type, "label": label, "cwd": cwd, "cwd_root": cwd}
            if cwd
            else {"node_type": node_type, "label": label}
        ),
    )

    return ResolvedProvider(
        adapter_name=adapter_name,
        adapter=get_adapter(adapter_name),
        config=config,
        connection_id=connection_id,
        connection_label=conn_label,
    )
