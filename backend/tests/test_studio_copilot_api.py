"""POST /studio/copilot/plan — offline path and request limits (plan S1)."""
from __future__ import annotations

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from main import app
from studio_copilot import catalog, ops

EXAMPLES = json.loads((Path(catalog.__file__).resolve().parent / "contract_examples.json").read_text(encoding="utf-8"))
BASE = EXAMPLES["baseGraph"]


@pytest.fixture()
def client():
    with TestClient(app) as c:
        yield c


def _body(**over):
    body = {"message": "Research → write → review flow", "history": [], "graph": BASE, "mode": "mock", "connection_id": None}
    body.update(over)
    return body


def test_mock_plan_returns_a_valid_offline_plan(client):
    res = client.post("/studio/copilot/plan", json=_body())
    assert res.status_code == 200
    data = res.json()
    assert set(data) == {"summary", "ops", "source", "tokens"}
    assert data["source"] == "offline"
    assert data["tokens"] == 0
    assert data["summary"].startswith("Offline draft")
    assert ops.validate_ops(BASE, data["ops"])["ok"] is True


@pytest.mark.parametrize("mode", ["live", "local"])
def test_non_mock_modes_are_not_ready_yet(client, mode):
    res = client.post("/studio/copilot/plan", json=_body(mode=mode, connection_id="c1"))
    assert res.status_code == 501
    assert res.json() == {"error": "live_not_ready"}


def test_oversized_message_is_invalid_argument(client):
    res = client.post("/studio/copilot/plan", json=_body(message="x" * 2001))
    assert res.status_code == 400
    assert res.json()["error"] == "invalid_argument"


def test_empty_message_and_long_history_are_invalid_argument(client):
    assert client.post("/studio/copilot/plan", json=_body(message="")).status_code == 400
    history = [{"role": "user", "text": "hi"}] * 7
    assert client.post("/studio/copilot/plan", json=_body(history=history)).status_code == 400


def test_too_many_nodes_is_payload_too_large(client):
    graph = {"nodes": [{"id": f"a{i}", "type": "agent", "label": "A", "config": {}} for i in range(61)], "edges": []}
    res = client.post("/studio/copilot/plan", json=_body(graph=graph))
    assert res.status_code == 413
    assert res.json() == {"error": "payload_too_large"}


def test_too_many_edges_is_payload_too_large(client):
    edge = {"source": "a", "sourceHandle": "out", "target": "b", "targetHandle": "in"}
    graph = {"nodes": [], "edges": [edge] * 121}
    assert client.post("/studio/copilot/plan", json=_body(graph=graph)).status_code == 413


def test_huge_body_is_payload_too_large(client):
    res = client.post(
        "/studio/copilot/plan",
        content=json.dumps(_body(message="ok", history=[], graph={"nodes": [], "edges": [], "pad": "x" * 300000})),
        headers={"content-type": "application/json"},
    )
    assert res.status_code == 413


def test_unknown_top_level_key_is_rejected(client):
    assert client.post("/studio/copilot/plan", json=_body(cwd="C:/work")).status_code == 400


def test_non_json_body_is_invalid_argument(client):
    res = client.post("/studio/copilot/plan", content=b"not json", headers={"content-type": "application/json"})
    assert res.status_code == 400
    assert res.json()["error"] == "invalid_argument"


def test_bad_mode_is_invalid_argument(client):
    assert client.post("/studio/copilot/plan", json=_body(mode="cloud")).status_code == 400


def test_sidecar_token_is_required():
    from fastapi.testclient import TestClient as TC

    # conftest monkeypatches TestClient.request to inject the token; bypass it with a raw ASGI call.
    import anyio
    import httpx

    async def go():
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://t") as c:
            return await c.post("/studio/copilot/plan", json=_body())

    assert anyio.run(go).status_code == 401
