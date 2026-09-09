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


def test_run_now_endpoint_mock_execute(client: TestClient) -> None:
    job = _create_job(client, cron=None, harness=False)
    r = client.post(f"/automations/{job['id']}/run")
    assert r.status_code == 200
    body = r.json()
    assert body["id"] == job["id"]
    assert body["status"] == "complete"
    assert body["lastRunAt"] is not None
    assert body["harnessEnabled"] is False
    assert body.get("result", {}).get("ok") is True
    assert body["result"]["harnessEnabled"] is False


def test_run_now_respects_harness_enabled(client: TestClient) -> None:
    job = _create_job(client, cron=None, harness=True)
    body = client.post(f"/automations/{job['id']}/run").json()
    assert body["harnessEnabled"] is True
    assert body["result"]["harnessEnabled"] is True


def test_run_now_unknown_job_404(client: TestClient) -> None:
    assert client.post("/automations/missing/run").status_code == 404


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
