"""GET/PUT /usage/budget, GET /usage/summary."""
from __future__ import annotations

import anyio
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete

import usage_tracking as ut
from database import SessionLocal
from main import app
from models import BudgetConfig, UsageRecord


async def _reset() -> None:
    async with SessionLocal() as db:
        await db.execute(delete(UsageRecord))
        await db.execute(delete(BudgetConfig))
        await db.commit()


@pytest.fixture()
def client():
    with TestClient(app) as c:
        anyio.run(_reset)
        yield c
    anyio.run(_reset)


def test_budget_defaults_to_unset(client: TestClient) -> None:
    resp = client.get("/usage/budget")
    assert resp.status_code == 200
    body = resp.json()
    assert body["limitUsd"] is None
    assert body["state"] == "unset"


def test_put_budget_round_trips(client: TestClient) -> None:
    resp = client.put("/usage/budget", json={"limitUsd": 25.0})
    assert resp.status_code == 200
    assert resp.json()["limitUsd"] == 25.0

    again = client.get("/usage/budget")
    assert again.json()["limitUsd"] == 25.0


def test_put_budget_null_clears_it(client: TestClient) -> None:
    client.put("/usage/budget", json={"limitUsd": 25.0})
    resp = client.put("/usage/budget", json={"limitUsd": None})
    assert resp.status_code == 200
    assert resp.json()["limitUsd"] is None
    assert resp.json()["state"] == "unset"


def test_put_negative_budget_is_rejected(client: TestClient) -> None:
    resp = client.put("/usage/budget", json={"limitUsd": -1.0})
    assert resp.status_code == 400


def test_summary_is_zeroed_with_no_usage(client: TestClient) -> None:
    resp = client.get("/usage/summary")
    assert resp.status_code == 200
    body = resp.json()
    assert body["totalTokens"] == 0
    assert body["totalCostUsd"] == 0.0
    assert body["byConnection"] == []
    assert body["budget"]["state"] == "unset"


def test_summary_aggregates_by_connection_and_source(client: TestClient) -> None:
    async def seed() -> None:
        async with SessionLocal() as db:
            await ut.record_usage(
                db, run_id="r1", node_id="a", source="harness",
                connection_id="anthropic", provider="anthropic", adapter="claude",
                model="claude-sonnet-5", tokens_total=100_000,  # $0.90
            )
            await ut.record_usage(
                db, run_id="r1", node_id="b", source="harness",
                connection_id="anthropic", provider="anthropic", adapter="claude",
                model="claude-sonnet-5", tokens_total=100_000,  # $0.90
            )
            await ut.record_usage(
                db, run_id="r2", node_id=None, source="direct",
                connection_id="ollama-local", provider="ollama", adapter="ollama",
                model="qwen3.5:9b", tokens_total=50_000,  # unpriced, local
            )

    anyio.run(seed)

    body = client.get("/usage/summary").json()
    assert body["totalTokens"] == 250_000
    assert body["totalCostUsd"] == pytest.approx(1.8)
    assert body["unpricedTokens"] == 50_000

    by_conn = {row["connectionId"]: row for row in body["byConnection"]}
    assert by_conn["anthropic"]["tokensTotal"] == 200_000
    assert by_conn["anthropic"]["costUsd"] == pytest.approx(1.8)
    assert by_conn["anthropic"]["unpricedTokens"] == 0
    assert by_conn["ollama-local"]["tokensTotal"] == 50_000
    assert by_conn["ollama-local"]["costUsd"] == 0.0
    assert by_conn["ollama-local"]["unpricedTokens"] == 50_000

    by_source = {row["source"]: row for row in body["bySource"]}
    assert by_source["harness"]["tokensTotal"] == 200_000
    assert by_source["direct"]["tokensTotal"] == 50_000


def test_summary_reflects_budget_state(client: TestClient) -> None:
    client.put("/usage/budget", json={"limitUsd": 1.0})

    async def seed() -> None:
        async with SessionLocal() as db:
            await ut.record_usage(
                db, run_id="r1", node_id="a", source="harness",
                connection_id="anthropic", provider="anthropic", adapter="claude",
                model="claude-opus-5", tokens_total=100_000,  # $4.50 > $1
            )

    anyio.run(seed)

    body = client.get("/usage/summary").json()
    assert body["budget"]["state"] == "exceeded"
    assert body["budget"]["limitUsd"] == 1.0
