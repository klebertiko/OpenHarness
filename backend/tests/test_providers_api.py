"""Providers API — catalog + connection CRUD; secrets never leak on GET."""

from __future__ import annotations

import json

import pytest
from fastapi.testclient import TestClient

from main import app
from secrets.memory import MemorySecrets

RAW_KEY = "sk-ant-TEST-SECRET-VALUE-NEVER-LEAK-9f3a"


@pytest.fixture()
def client():
    store = MemorySecrets()
    connections: dict = {}
    app.state.secrets_store = store
    app.state.provider_connections = connections
    with TestClient(app) as c:
        # Re-apply after lifespan so tests always use MemorySecrets.
        app.state.secrets_store = store
        app.state.provider_connections = connections
        yield c


def _assert_no_raw_key(payload: object) -> None:
    blob = json.dumps(payload)
    assert RAW_KEY not in blob
    assert "NEVER-LEAK" not in blob


def test_catalog_lists_providers_including_openrouter(client: TestClient) -> None:
    r = client.get("/providers/catalog")
    assert r.status_code == 200
    body = r.json()
    ids = {p["id"] for p in body["providers"]}
    assert ids >= {"anthropic", "cursor", "openai", "ollama", "openrouter"}
    openrouter = next(p for p in body["providers"] if p["id"] == "openrouter")
    assert openrouter["vendor"] == "OpenRouter"
    assert openrouter["credential"]["kind"] == "api-key"


def test_create_list_get_update_delete_connection_metadata(client: TestClient) -> None:
    create = client.post(
        "/providers/connections",
        json={
            "id": "anthropic",
            "provider": "anthropic",
            "label": "Anthropic",
            "residence": "cloud",
            "endpoint": "https://api.anthropic.com",
        },
    )
    assert create.status_code == 201
    created = create.json()
    assert created["id"] == "anthropic"
    assert created.get("secretRef") is None
    _assert_no_raw_key(created)

    listed = client.get("/providers/connections")
    assert listed.status_code == 200
    assert any(c["id"] == "anthropic" for c in listed.json()["connections"])
    _assert_no_raw_key(listed.json())

    got = client.get("/providers/connections/anthropic")
    assert got.status_code == 200
    assert got.json()["provider"] == "anthropic"
    _assert_no_raw_key(got.json())

    updated = client.put(
        "/providers/connections/anthropic",
        json={"label": "Anthropic workspace", "enabled": True},
    )
    assert updated.status_code == 200
    assert updated.json()["label"] == "Anthropic workspace"
    assert updated.json()["enabled"] is True
    _assert_no_raw_key(updated.json())

    deleted = client.delete("/providers/connections/anthropic")
    assert deleted.status_code == 204
    assert client.get("/providers/connections/anthropic").status_code == 404


def test_post_secret_stores_via_secrets_store_returns_ref(client: TestClient) -> None:
    client.post(
        "/providers/connections",
        json={
            "id": "openai",
            "provider": "openai",
            "label": "OpenAI",
            "residence": "cloud",
            "endpoint": "https://api.openai.com/v1",
        },
    )
    r = client.post("/providers/openai/secret", json={"key": RAW_KEY})
    assert r.status_code == 200
    body = r.json()
    assert "secretRef" in body
    assert body["secretRef"] == "openharness/openai"
    assert RAW_KEY not in json.dumps(body)

    store: MemorySecrets = app.state.secrets_store
    assert store.exists("openharness/openai")
    assert store.get("openharness/openai") == RAW_KEY


def test_get_connections_never_contains_sk_material(client: TestClient) -> None:
    client.post(
        "/providers/connections",
        json={
            "id": "openai",
            "provider": "openai",
            "label": "OpenAI",
            "residence": "cloud",
            "endpoint": "https://api.openai.com/v1",
        },
    )
    client.post("/providers/openai/secret", json={"key": RAW_KEY})

    for path in ("/providers/connections", "/providers/connections/openai"):
        r = client.get(path)
        assert r.status_code == 200
        blob = json.dumps(r.json())
        assert RAW_KEY not in blob
        assert "sk-" not in blob
        meta = r.json()["connections"][0] if "connections" in r.json() else r.json()
        assert meta.get("secretRef") == "openharness/openai"
        for banned in ("key", "apiKey", "api_key", "secret", "plaintext"):
            assert banned not in meta or meta[banned] is None


def test_post_secret_unknown_connection_404(client: TestClient) -> None:
    r = client.post("/providers/missing/secret", json={"key": RAW_KEY})
    assert r.status_code == 404
