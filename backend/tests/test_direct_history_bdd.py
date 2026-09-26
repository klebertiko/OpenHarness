from fastapi.testclient import TestClient
from pytest_bdd import given, scenarios, then, when
import httpx
import pytest

from adapters.base import AgentAdapter, AdapterResult
from main import app

scenarios("features/direct_history.feature")


@pytest.fixture()
def state():
    return {"mode": "live", "fails": False}


@pytest.fixture()
def client(monkeypatch, state):
    class Provider(AgentAdapter):
        async def invoke(self, prompt, config):
            return AdapterResult(content="BDD response")

        async def stream(self, prompt, config):
            if state["fails"]:
                req = httpx.Request("POST", "https://example.invalid")
                raise httpx.HTTPStatusError("private credential", request=req,
                                            response=httpx.Response(401, request=req))
            yield "BDD response"

    monkeypatch.setattr("providers.resolution.get_adapter", lambda name: Provider())
    with TestClient(app) as client:
        monkeypatch.setattr(app.state, "provider_connections", {
            "bdd-provider": {"id": "bdd-provider", "provider": "anthropic", "enabled": True},
        })
        yield client


@given("an enabled provider returning a response")
def responding(state):
    state["fails"] = False


@given("an enabled provider failing authentication")
def failing(state):
    state["fails"] = True


@given("an explicit simulation")
def simulation(state):
    state["mode"] = "mock"


@when("I execute a direct instruction")
def execute(client, state):
    response = client.post("/execute/direct", json={
        "instruction": "hello", "connection_id": "bdd-provider", "mode": state["mode"],
    })
    assert response.status_code == 200
    run_id = response.headers["X-Execution-Id"]
    detail = client.get(f"/execute/logs/{run_id}")
    assert detail.status_code == 200
    state["history"] = detail.json()
    assert state["history"]["id"] == run_id
    assert state["history"]["source"] == "direct"
    assert state["history"]["finished_at"] is not None


@then("the history contains the verified response")
def verified(state):
    history = state["history"]
    assert history["status"] == "complete"
    done = next(e["data"] for e in history["result"]["events"] if e["event"] == "node_done")
    assert done["output"] == "BDD response"
    assert done["connection_id"] == "bdd-provider"
    assert done["provider_verified"] is True


@then("the history contains a safe failed outcome")
def failed(state):
    history = state["history"]
    assert history["status"] == "failed"
    failure = next(e["data"] for e in history["result"]["events"] if e["event"] == "node_error")
    assert failure["provider_failure"] == "authentication"
    assert "private" not in str(history)


@then("the history contains an unverified simulated response")
def simulated(state):
    history = state["history"]
    assert history["status"] == "complete"
    events = history["result"]["events"]
    assert next(e["data"] for e in events if e["event"] == "node_start")["adapter"] == "mock"
    assert not any(e["data"].get("provider_verified") for e in events)
