"""Automation scheduler + POST /automations/{id}/run."""

from __future__ import annotations

from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient

from automations.scheduler import AutomationScheduler, cron_matches
from main import app


@pytest.fixture()
def client():
    with TestClient(app) as c:
        yield c


def _create_job(client: TestClient, *, cron: str | None = "* * * * *", harness: bool = True) -> dict:
    r = client.post(
        "/automations/",
        json={
            "name": "Tick job",
            "cron": cron,
            "harnessEnabled": harness,
        },
    )
    assert r.status_code == 201
    return r.json()


def test_run_now_live_mode_reaches_real_adapter_not_mock(monkeypatch, client: TestClient) -> None:
    """Piece 1, first RED slice (written before any implementation, per the
    story's sequencing discipline): a harness-enabled job's /run in
    mode="live" must reach a real adapter via resolve_node_provider -- the
    same seam routers/execution.py's real runs use -- instead of silently
    running mock_execute. Needs no piece-2 fields (instruction/connection on
    AutomationJob do not exist yet): the harness graph's own `input` node
    already carries the prompt, and the `llm` node's providerIds already
    pins a connection, exactly like a normal harness run. Stubs the adapter
    at the same seam test_execution_provider_resolution.py uses so no
    network/credentials are needed -- the point is proving the wiring reaches
    that seam at all, not re-testing resolve_node_provider's own correctness
    (already covered exhaustively elsewhere)."""
    from adapters.base import AdapterConfig, AgentAdapter, AdapterResult
    from main import app
    from secret_store.memory import MemorySecrets

    class _StubAdapter(AgentAdapter):
        async def invoke(self, prompt: str, config: AdapterConfig) -> AdapterResult:
            return AdapterResult(content="real automation output", tokens_used=7)

        async def stream(self, prompt: str, config: AdapterConfig):
            yield "real automation output"

    monkeypatch.setattr("providers.resolution.get_adapter", lambda name: _StubAdapter())
    store = MemorySecrets()
    store.put("openharness/anthropic", "sk-ant-REAL")
    app.state.secrets_store = store
    app.state.provider_connections = {
        "anthropic": {
            "id": "anthropic",
            "provider": "anthropic",
            "label": "Anthropic",
            "residence": "cloud",
            "endpoint": "https://api.anthropic.com",
            "enabled": True,
            "secretRef": "openharness/anthropic",
        }
    }

    harness = client.post(
        "/harnesses/",
        json={
            "name": "Real automation harness",
            "description": "",
            "graph_json": {
                "nodes": [
                    {"id": "in", "type": "input", "data": {"prompt": "digest the inbox"}},
                    {"id": "draft", "type": "llm", "data": {"label": "Draft", "providerIds": ["anthropic"]}},
                ],
                "edges": [{"source": "in", "target": "draft"}],
            },
        },
    ).json()

    job = client.post(
        "/automations/",
        json={
            "name": "Real run job",
            "cron": None,
            "harnessBundleId": harness["id"],
            "harnessEnabled": True,
        },
    ).json()

    r = client.post(f"/automations/{job['id']}/run", json={"mode": "live"})
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "complete"
    assert body["result"]["mode"] != "mock"
    assert "real automation output" in str(body["result"])


def test_run_now_mock_mode_endpoint(client: TestClient) -> None:
    """Supersedes the old `test_run_now_endpoint_mock_execute`, which
    asserted mock output from a bare `POST .../run` -- that was the gap this
    story closes (`/run` defaults to real execution now; see
    `test_run_now_live_mode_reaches_real_adapter_not_mock` above and
    `test_run_now_unconfigured_direct_job_fails_honestly_not_mock` below).
    The genuine, explicit, free simulate path this test used to describe by
    accident still exists and is still pinned -- it just needs `mode:
    "mock"` stated outright rather than being the silent default."""
    job = _create_job(client, cron=None, harness=False)
    r = client.post(f"/automations/{job['id']}/run", json={"mode": "mock"})
    assert r.status_code == 200
    body = r.json()
    assert body["id"] == job["id"]
    assert body["status"] == "complete"
    assert body["lastRunAt"] is not None
    assert body["harnessEnabled"] is False
    assert body.get("result", {}).get("ok") is True
    assert body["result"]["mode"] == "mock"
    assert body["result"]["harnessEnabled"] is False


def test_run_now_mock_mode_respects_harness_enabled(client: TestClient) -> None:
    """Supersedes the old `test_run_now_respects_harness_enabled` -- same
    reasoning as the test above."""
    job = _create_job(client, cron=None, harness=True)
    body = client.post(f"/automations/{job['id']}/run", json={"mode": "mock"}).json()
    assert body["harnessEnabled"] is True
    assert body["result"]["mode"] == "mock"
    assert body["result"]["harnessEnabled"] is True


def test_run_now_unconfigured_direct_job_fails_honestly_not_mock(client: TestClient) -> None:
    """The real counterpart to `test_run_now_mock_mode_endpoint` above: the
    exact same "Direct, no harness" job, run in the new default mode
    ("live"), must not silently succeed with mock output -- it has no
    instruction configured (piece 2), so real execution honestly refuses it,
    the same way an unpinned harness node honestly refuses instead of
    resolving to MockAdapter (providers/resolution.py's own rule)."""
    job = _create_job(client, cron=None, harness=False)
    r = client.post(f"/automations/{job['id']}/run", json={"mode": "live"})
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "error"
    assert body["result"]["ok"] is False
    assert body["result"]["mode"] == "live"
    assert body["result"]["failure"] == "unresolved-connection"
    assert "instruction" in body["result"]["error"].lower()


def test_run_now_configured_direct_job_reaches_real_adapter(monkeypatch, client: TestClient) -> None:
    """Piece 2's fields (instruction/connectionId) completing piece 1's
    Direct-mode branch: once a Direct job actually names an instruction and
    a connection, "live" mode resolves and invokes a real adapter via
    resolve_node_provider -- the same primitive the harness path already
    proved wired in `test_run_now_live_mode_reaches_real_adapter_not_mock`."""
    from adapters.base import AdapterConfig, AgentAdapter, AdapterResult
    from main import app
    from secret_store.memory import MemorySecrets

    class _StubAdapter(AgentAdapter):
        async def invoke(self, prompt: str, config: AdapterConfig) -> AdapterResult:
            assert prompt == "Summarize today's inbox"
            return AdapterResult(content="Inbox summary: 3 new threads.", tokens_used=11)

        async def stream(self, prompt: str, config: AdapterConfig):
            yield "Inbox summary: 3 new threads."

    monkeypatch.setattr("providers.resolution.get_adapter", lambda name: _StubAdapter())
    store = MemorySecrets()
    store.put("openharness/anthropic", "sk-ant-REAL")
    app.state.secrets_store = store
    app.state.provider_connections = {
        "anthropic": {
            "id": "anthropic",
            "provider": "anthropic",
            "label": "Anthropic",
            "residence": "cloud",
            "endpoint": "https://api.anthropic.com",
            "enabled": True,
            "secretRef": "openharness/anthropic",
        }
    }

    job = client.post(
        "/automations/",
        json={
            "name": "Direct real job",
            "cron": None,
            "harnessEnabled": False,
            "instruction": "Summarize today's inbox",
            "connectionId": "anthropic",
        },
    ).json()
    assert job["instruction"] == "Summarize today's inbox"
    assert job["connectionId"] == "anthropic"

    r = client.post(f"/automations/{job['id']}/run", json={"mode": "live"})
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "complete"
    assert body["result"]["mode"] == "live"
    assert body["result"]["output"] == "Inbox summary: 3 new threads."
    assert body["result"]["adapter"] == "claude"
    assert body["result"]["connectionId"] == "anthropic"


def test_run_now_unknown_job_404(client: TestClient) -> None:
    assert client.post("/automations/missing/run").status_code == 404


def test_run_now_mock_mode_ignores_an_exhausted_budget(client: TestClient) -> None:
    """Supersedes the old `test_run_now_ignores_an_exhausted_budget` (SEC
    P3-4). Its docstring used to describe an accident: `/run` always mocked,
    so nothing ever reached the budget gate. Now that "live" is the default
    and reaches `usage_tracking.enforce_budget_or_raise` for real (see
    `test_run_now_live_mode_blocked_by_exhausted_budget` below), the
    guarantee this test actually needs to keep pinning is narrower but still
    real: the *explicit, honest* simulate path must stay exempt from the
    budget, exactly like `POST /execute/` and `POST /execute/direct` already
    exempt `mode="mock"` (never blocked by a budget it can't possibly spend
    against)."""
    client.put("/usage/budget", json={"limitUsd": 0})
    job = _create_job(client, cron=None, harness=True)

    r = client.post(f"/automations/{job['id']}/run", json={"mode": "mock"})

    assert r.status_code == 200
    assert r.json()["status"] == "complete"
    assert r.json()["result"]["mode"] == "mock"


def test_run_now_live_mode_blocked_by_exhausted_budget(monkeypatch, client: TestClient) -> None:
    """New counterpart proving the budget gate now actually applies to a
    real run -- the flip side of the mock-exemption test above, and the
    thing SEC P3-4's docstring said would only be true "when a real executor
    is ever wired in". Uses the same harness-graph shape as
    `test_run_now_live_mode_reaches_real_adapter_not_mock`."""
    from adapters.base import AdapterConfig, AgentAdapter, AdapterResult
    from main import app
    from secret_store.memory import MemorySecrets

    class _StubAdapter(AgentAdapter):
        async def invoke(self, prompt, config):
            return AdapterResult(content="should not run", tokens_used=7)

        async def stream(self, prompt, config):
            yield "should not run"

    monkeypatch.setattr("providers.resolution.get_adapter", lambda name: _StubAdapter())
    store = MemorySecrets()
    store.put("openharness/anthropic", "sk-ant-REAL")
    app.state.secrets_store = store
    app.state.provider_connections = {
        "anthropic": {
            "id": "anthropic",
            "provider": "anthropic",
            "label": "Anthropic",
            "residence": "cloud",
            "endpoint": "https://api.anthropic.com",
            "enabled": True,
            "secretRef": "openharness/anthropic",
        }
    }
    client.put("/usage/budget", json={"limitUsd": 0})

    harness = client.post(
        "/harnesses/",
        json={
            "name": "Budget-blocked harness",
            "description": "",
            "graph_json": {
                "nodes": [
                    {"id": "in", "type": "input", "data": {"prompt": "hi"}},
                    {"id": "draft", "type": "llm", "data": {"label": "Draft", "providerIds": ["anthropic"]}},
                ],
                "edges": [{"source": "in", "target": "draft"}],
            },
        },
    ).json()
    job = client.post(
        "/automations/",
        json={"name": "Budget job", "cron": None, "harnessBundleId": harness["id"], "harnessEnabled": True},
    ).json()

    r = client.post(f"/automations/{job['id']}/run", json={"mode": "live"})

    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "error"
    assert body["result"]["failure"] == "budget-exceeded"
    assert "budget" in body["result"]["error"].lower()


def test_cron_matches_every_minute() -> None:
    dt = datetime(2026, 9, 9, 12, 34, tzinfo=timezone.utc)
    assert cron_matches("* * * * *", dt) is True
    assert cron_matches("35 * * * *", dt) is False
    assert cron_matches("34 * * * *", dt) is True


def test_scheduler_tick_fires_cron_job_once(client: TestClient) -> None:
    """Fake clock: one matching minute fires mock execute exactly once."""
    import asyncio

    from database import SessionLocal

    # Narrow cron so leftover * * * * * rows in the shared DB do not fire.
    job = _create_job(client, cron="7 3 9 9 *", harness=True)
    executes: list[str] = []

    async def capture_execute(job_row):
        executes.append(job_row.id)
        return {"ok": True, "harnessEnabled": job_row.harness_enabled, "mode": "mock"}

    clock = {"t": datetime(2026, 9, 9, 3, 7, tzinfo=timezone.utc)}

    def now():
        return clock["t"]

    sched = AutomationScheduler(
        session_factory=SessionLocal,
        execute_fn=capture_execute,
        now_fn=now,
    )

    async def exercise() -> None:
        await sched.tick()
        assert executes.count(job["id"]) == 1
        # Same minute again — do not double-fire this job
        await sched.tick()
        assert executes.count(job["id"]) == 1
        # Next minute — fires again
        clock["t"] = datetime(2026, 9, 9, 3, 8, tzinfo=timezone.utc)
        # cron still 7 — should NOT fire at minute 8
        await sched.tick()
        assert executes.count(job["id"]) == 1
        # Update job cron via API to minute 8, then tick
        client.put(f"/automations/{job['id']}", json={"cron": "8 3 9 9 *"})
        await sched.tick()
        assert executes.count(job["id"]) == 2

    asyncio.run(exercise())
