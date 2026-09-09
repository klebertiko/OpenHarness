"""Providers API — catalog + connection metadata CRUD; secrets via SecretsStore.

Responses never include raw API keys. POST /providers/{id}/secret accepts a key
once, stores it, and returns only ``{secretRef}``.
"""

from __future__ import annotations

from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from adapters.catalog import list_catalog
from secrets.base import SecretsStore

router = APIRouter(prefix="/providers", tags=["providers"])

Residence = Literal["local", "cloud"]


class ConnectionCreate(BaseModel):
    id: str
    provider: str
    label: str
    residence: Residence = "cloud"
    endpoint: str = ""
    enabled: bool = False


class ConnectionUpdate(BaseModel):
    label: str | None = None
    residence: Residence | None = None
    endpoint: str | None = None
    enabled: bool | None = None


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
    }
    connections[body.id] = row
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
    return _public_connection(row)


@router.delete("/connections/{connection_id}", status_code=204)
async def delete_connection(
    connection_id: str,
    connections: dict = Depends(get_connections),
    store: SecretsStore = Depends(get_secrets_store),
):
    row = connections.pop(connection_id, None)
    if not row:
        raise HTTPException(404, "Connection not found")
    ref = row.get("secretRef")
    if ref:
        store.delete(ref)
    return None


@router.post("/{connection_id}/secret")
async def put_secret(
    connection_id: str,
    body: SecretBody,
    connections: dict = Depends(get_connections),
    store: SecretsStore = Depends(get_secrets_store),
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
    return {"secretRef": ref}
