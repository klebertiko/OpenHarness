"""Providers API — catalog + connection metadata CRUD; secrets via SecretsStore.

Responses never include raw API keys. POST /providers/{id}/secret accepts a key
once, stores it, and returns only ``{secretRef}``.
"""

from __future__ import annotations

from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from adapters import AdapterConfig, get_adapter
from adapters.catalog import get_provider, list_catalog
from database import get_db
from providers import store as connection_store
from providers.resolution import ADAPTER_BY_PROVIDER
from secret_store.base import SecretsStore

router = APIRouter(prefix="/providers", tags=["providers"])

Residence = Literal["local", "cloud"]


class ConnectionCreate(BaseModel):
    id: str
    provider: str
    label: str
    residence: Residence = "cloud"
    endpoint: str = ""
    enabled: bool = False
    # HTTP-based providers (Ollama/OpenRouter/OpenAI-compatible) reject a
    # request with no model — "model is required" — unlike the CLI adapters,
    # which fall back to their own default when a node pins none. A graph
    # node's own `model` still wins when it has one; this is only the
    # fallback (see resolve_node_provider in providers/resolution.py).
    defaultModel: str = ""


class ConnectionUpdate(BaseModel):
    label: str | None = None
    residence: Residence | None = None
    endpoint: str | None = None
    enabled: bool | None = None
    defaultModel: str | None = None


class SecretBody(BaseModel):
    key: str = Field(..., min_length=1)


def get_secrets_store(request: Request) -> SecretsStore:
    store = getattr(request.app.state, "secrets_store", None)
    if store is None:
        raise HTTPException(503, "SecretsStore not configured")
    return store


def get_connections(request: Request) -> dict[str, dict[str, Any]]:
    conns = getattr(request.app.state, "provider_connections", None)
    if conns is None:
        raise HTTPException(503, "Provider connections store not configured")
    return conns


def _public_connection(row: dict[str, Any]) -> dict[str, Any]:
    """Strip anything that could be raw credential material."""
    return {
        "id": row["id"],
        "provider": row["provider"],
        "label": row["label"],
        "residence": row["residence"],
        "endpoint": row["endpoint"],
        "enabled": row.get("enabled", False),
        "secretRef": row.get("secretRef"),
        "defaultModel": row.get("defaultModel", ""),
    }


@router.get("/catalog")
async def get_catalog():
    return {"providers": list_catalog()}


@router.get("/connections")
async def list_connections(connections: dict = Depends(get_connections)):
    return {"connections": [_public_connection(c) for c in connections.values()]}


@router.post("/connections", status_code=201)
async def create_connection(
    body: ConnectionCreate,
    connections: dict = Depends(get_connections),
    db: AsyncSession = Depends(get_db),
):
    if body.id in connections:
        raise HTTPException(409, f"Connection '{body.id}' already exists")
    row = {
        "id": body.id,
        "provider": body.provider,
        "label": body.label,
        "residence": body.residence,
        "endpoint": body.endpoint,
        "enabled": body.enabled,
        "secretRef": None,
        "defaultModel": body.defaultModel,
    }
    connections[body.id] = row
    await connection_store.upsert(db, row)
    return _public_connection(row)


@router.get("/connections/{connection_id}")
async def get_connection(
    connection_id: str,
    connections: dict = Depends(get_connections),
):
    row = connections.get(connection_id)
    if not row:
        raise HTTPException(404, "Connection not found")
    return _public_connection(row)


@router.put("/connections/{connection_id}")
async def update_connection(
    connection_id: str,
    body: ConnectionUpdate,
    connections: dict = Depends(get_connections),
    db: AsyncSession = Depends(get_db),
):
    row = connections.get(connection_id)
    if not row:
        raise HTTPException(404, "Connection not found")
    if body.label is not None:
        row["label"] = body.label
    if body.residence is not None:
        row["residence"] = body.residence
    if body.endpoint is not None:
        row["endpoint"] = body.endpoint
    if body.enabled is not None:
        row["enabled"] = body.enabled
    if body.defaultModel is not None:
        row["defaultModel"] = body.defaultModel
    await connection_store.upsert(db, row)
    return _public_connection(row)


@router.delete("/connections/{connection_id}", status_code=204)
async def delete_connection(
    connection_id: str,
    connections: dict = Depends(get_connections),
    store: SecretsStore = Depends(get_secrets_store),
    db: AsyncSession = Depends(get_db),
):
    row = connections.pop(connection_id, None)
    if not row:
        raise HTTPException(404, "Connection not found")
    ref = row.get("secretRef")
    if ref:
        store.delete(ref)
    await connection_store.delete(db, connection_id)
    return None


@router.post("/{connection_id}/probe")
async def probe_connection(
    connection_id: str,
    connections: dict = Depends(get_connections),
    store: SecretsStore = Depends(get_secrets_store),
):
    """
    Reachability + credential check — never spends tokens (`ProbeResult`'s own
    contract, `backend/adapters/base.py`). For a CLI-backed connection
    (anthropic, cursor) this runs the vendor CLI's own lightweight auth-status
    command; there is no key to validate. For an api-key connection this hits
    the vendor's own no-cost `GET /models`, with the stored key attached so a
    bad or missing credential surfaces as a real 401 rather than looking live.
    """
    row = connections.get(connection_id)
    if not row:
        raise HTTPException(404, "Connection not found")

    # Same translation resolve_node_provider() applies for a run: get_adapter()
    # is keyed by CLI/wire-protocol name ("claude"), not connection.provider
    # ("anthropic") — skipping it silently probes MockAdapter instead of the
    # real adapter and reports a false "not implemented".
    adapter_name = ADAPTER_BY_PROVIDER.get(row["provider"], row["provider"])
    adapter = get_adapter(adapter_name)

    api_key = ""
    spec = get_provider(row["provider"]) or {}
    if spec.get("credential", {}).get("kind") == "api-key" and row.get("secretRef"):
        api_key = store.get(row["secretRef"]) or ""

    config = AdapterConfig(adapter=adapter_name, model="", endpoint=row.get("endpoint", ""), api_key=api_key)
    result = await adapter.probe(config)
    return {
        "ok": result.ok,
        "health": result.health,
        "detail": result.detail,
        "latencyMs": result.latency_ms,
        "facts": [{"k": k, "v": v, "tone": tone} for k, v, tone in result.facts],
    }


@router.post("/{connection_id}/secret")
async def put_secret(
    connection_id: str,
    body: SecretBody,
    connections: dict = Depends(get_connections),
    store: SecretsStore = Depends(get_secrets_store),
    db: AsyncSession = Depends(get_db),
):
    row = connections.get(connection_id)
    if not row:
        raise HTTPException(404, "Connection not found")
    value = body.key.strip()
    if not value:
        raise HTTPException(400, "empty credential")
    ref = f"openharness/{connection_id}"
    store.put(ref, value)
    row["secretRef"] = ref
    row["enabled"] = True
    await connection_store.upsert(db, row)
    return {"secretRef": ref}
