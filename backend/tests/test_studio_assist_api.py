"""POST /studio/assist/field — offline path and request limits (plan S4)."""
from __future__ import annotations

import json

import pytest
from fastapi.testclient import TestClient

from main import app


@pytest.fixture()
def client():
    with TestClient(app) as c:
        yield c


def _body(**over):
    body = {
        "field": "systemPrompt",
        "action": "draft",
        "node": {"type": "agent", "label": "Reviewer"},
        "current": "",
        "intent": "review pull requests for test coverage",
        "neighbours": [],
        "harnessName": "Demo",
        "mode": "mock",
        "connection_id": None,
    }
    body.update(over)
    return body


def test_mock_draft_returns_offline_text(client):
    res = client.post("/studio/assist/field", json=_body())
    assert res.status_code == 200
    data = res.json()
    assert set(data) == {"text", "notes", "source", "tokens"}
    assert data["source"] == "offline" and data["tokens"] == 0
    assert data["text"].startswith("You are the Reviewer agent.")


def test_mock_review_returns_null_text(client):
    res = client.post("/studio/assist/field", json=_body(action="review", current="short"))
    assert res.status_code == 200
    assert res.json()["text"] is None
    assert res.json()["notes"]


def test_checklist_on_an_agent_is_not_assistable(client):
    res = client.post("/studio/assist/field", json=_body(field="checklist"))
    assert res.status_code == 400
    assert res.json()["error"] == "field_not_assistable"


@pytest.mark.parametrize("node_type", ["hitl", "mcp", "tool"])
def test_non_assistable_node_types_are_rejected(client, node_type):
    res = client.post("/studio/assist/field", json=_body(node={"type": node_type, "label": "N"}))
    assert res.status_code == 400
    assert res.json()["error"] == "field_not_assistable"


def test_draft_needs_an_intent(client):
    for intent in ("", "   "):
        res = client.post("/studio/assist/field", json=_body(intent=intent))
        assert res.status_code == 400
        assert res.json()["error"] == "invalid_argument"


def test_current_over_the_limit_is_rejected(client):
    res = client.post("/studio/assist/field", json=_body(action="improve", current="x" * 8001))
    assert res.status_code == 400
    assert res.json()["error"] == "invalid_argument"


def test_unknown_key_and_bad_mode_are_rejected(client):
    assert client.post("/studio/assist/field", json=_body(cwd="C:/x")).status_code == 400
    assert client.post("/studio/assist/field", json=_body(mode="cloud")).status_code == 400


def test_too_many_neighbours_is_rejected(client):
    n = {"direction": "in", "type": "agent", "label": "A", "port": "out"}
    assert client.post("/studio/assist/field", json=_body(neighbours=[n] * 9)).status_code == 400


def test_huge_body_is_payload_too_large(client):
    res = client.post(
        "/studio/assist/field",
        content=json.dumps(_body(harnessName="x", current="y", extra="z" * 300000)),
        headers={"content-type": "application/json"},
    )
    assert res.status_code == 413
    assert res.json() == {"error": "payload_too_large"}


@pytest.mark.parametrize("mode", ["live", "local"])
def test_non_mock_modes_are_not_ready_yet(client, mode):
    res = client.post("/studio/assist/field", json=_body(mode=mode, connection_id="c1"))
    assert res.status_code == 501
    assert res.json() == {"error": "live_not_ready"}
