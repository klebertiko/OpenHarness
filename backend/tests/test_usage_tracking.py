"""
Usage ledger + global budget -- the money-shaped arithmetic this feature adds.

cost = tokens x price / 1,000,000, using a *blended* input/output rate: the
adapter layer (backend/adapters/base.py's `usage` SSE event, and every real
adapter behind it) only ever reports one combined token count today, never a
separate input/output split -- see adapters/claude.py, cli_claude.py,
cli_codex.py, openai_compatible.py, all of which collapse `input_tokens +
output_tokens` (or `total_tokens`) before it ever reaches the engine. An exact
per-directional cost is therefore not something this backend can compute
without changing that contract, which is out of scope for this pass (see the
handoff). The blended rate -- average of the catalog's [in, out] price -- is
the honest, documented approximation given that constraint.

Numbers below are chosen to be hand-checkable:
  claude-sonnet-5   price [3, 15]  -> blended 9  $/Mtok
  claude-opus-5     price [15, 75] -> blended 45 $/Mtok
"""
from __future__ import annotations

import anyio
import pytest
from sqlalchemy import delete, func, select

import usage_tracking as ut
from database import Base, SessionLocal, engine
from models import BudgetConfig, UsageRecord


async def _reset() -> None:
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    async with SessionLocal() as db:
        await db.execute(delete(UsageRecord))
        await db.execute(delete(BudgetConfig))
        await db.commit()


@pytest.fixture(autouse=True)
def _clean_tables():
    """Every test starts from zero rows. The suite's shared sqlite file
    otherwise carries usage/budget rows across test files (conftest.py's
    isolation is per-*process*, not per-test), which would make the exact
    sums this file asserts on order-dependent."""
    anyio.run(_reset)
    yield
    anyio.run(_reset)


async def _count_rows() -> int:
    async with SessionLocal() as db:
        res = await db.execute(select(func.count()).select_from(UsageRecord))
        return res.scalar_one()


# ── compute_cost: pure arithmetic ───────────────────────────────────────────


def test_compute_cost_uses_blended_input_output_rate() -> None:
    cost, price = ut.compute_cost(1_000_000, "claude-sonnet-5")
    assert price == pytest.approx(9.0)
    assert cost == pytest.approx(9.0)


def test_compute_cost_scales_linearly_with_tokens() -> None:
    cost, _ = ut.compute_cost(500_000, "claude-sonnet-5")
    assert cost == pytest.approx(4.5)


def test_compute_cost_unknown_model_is_unknown_not_free() -> None:
    cost, price = ut.compute_cost(10_000, "some-model-not-in-any-catalog")
    assert cost is None
    assert price is None


def test_compute_cost_zero_tokens_is_zero_cost() -> None:
    cost, _ = ut.compute_cost(0, "claude-sonnet-5")
    assert cost == 0.0


# ── record_usage: the ledger write path ─────────────────────────────────────


def test_record_usage_writes_a_row_with_cost_computed_at_write_time() -> None:
    async def go() -> UsageRecord | None:
        async with SessionLocal() as db:
            return await ut.record_usage(
                db,
                run_id="r1",
                node_id="draft",
                source="harness",
                connection_id="anthropic",
                provider="anthropic",
                adapter="claude",
                model="claude-sonnet-5",
                tokens_total=100_000,
            )

    row = anyio.run(go)
    assert row is not None
    assert row.cost_usd == pytest.approx(0.9)  # 100k tok * 9 $/Mtok
    assert row.price_per_mtok == pytest.approx(9.0)
    assert row.connection_id == "anthropic"
    assert anyio.run(_count_rows) == 1


def test_record_usage_skips_mock_adapter_no_row_no_cost() -> None:
    """Mock mode is Studio's own authoring/testing mode -- it never reaches a
    real vendor and its token counts are synthetic estimates, not real usage.
    The ledger must stay real-usage-only or the Providers screen's "real
    token counts" promise is a lie."""
    async def go() -> UsageRecord | None:
        async with SessionLocal() as db:
            return await ut.record_usage(
                db,
                run_id="r1",
                node_id="draft",
                source="harness",
                connection_id=None,
                provider="",
                adapter="mock",
                model="mock-1",
                tokens_total=5_000,
            )

    row = anyio.run(go)
    assert row is None
    assert anyio.run(_count_rows) == 0


def test_record_usage_skips_unresolved_adapter() -> None:
    async def go() -> UsageRecord | None:
        async with SessionLocal() as db:
            return await ut.record_usage(
                db,
                run_id="r1",
                node_id="draft",
                source="harness",
                connection_id=None,
                provider="",
                adapter="unresolved",
                model="",
                tokens_total=0,
            )

    assert anyio.run(go) is None
    assert anyio.run(_count_rows) == 0


def test_record_usage_skips_zero_tokens() -> None:
    async def go() -> UsageRecord | None:
        async with SessionLocal() as db:
            return await ut.record_usage(
                db,
                run_id="r1",
                node_id="draft",
                source="harness",
                connection_id="anthropic",
                provider="anthropic",
                adapter="claude",
                model="claude-sonnet-5",
                tokens_total=0,
            )

    assert anyio.run(go) is None
    assert anyio.run(_count_rows) == 0


def test_record_usage_rows_writes_only_the_real_ones() -> None:
    async def go() -> list[UsageRecord]:
        async with SessionLocal() as db:
            return await ut.record_usage_rows(
                db,
                [
                    dict(
                        run_id="r1", node_id="a", source="harness",
                        connection_id="anthropic", provider="anthropic",
                        adapter="claude", model="claude-sonnet-5", tokens_total=10_000,
                    ),
                    dict(
                        run_id="r1", node_id="b", source="harness",
                        connection_id=None, provider="", adapter="mock",
                        model="mock-1", tokens_total=999,
                    ),
                ],
            )

    written = anyio.run(go)
    assert len(written) == 1
    assert written[0].node_id == "a"
    assert anyio.run(_count_rows) == 1


# ── budget: persistence + status thresholds ─────────────────────────────────


def test_budget_is_unset_by_default() -> None:
    async def go() -> ut.BudgetStatus:
        async with SessionLocal() as db:
            return await ut.get_budget_status(db)

    status = anyio.run(go)
    assert status.state == "unset"
    assert status.limit_usd is None
    assert status.pct is None


def test_setting_budget_persists_across_sessions() -> None:
    async def go() -> float | None:
        async with SessionLocal() as db:
            await ut.set_budget_limit(db, 10.0)
        async with SessionLocal() as db2:
            return await ut.get_budget_limit(db2)

    assert anyio.run(go) == 10.0


def test_clearing_budget_returns_to_unset() -> None:
    async def go() -> float | None:
        async with SessionLocal() as db:
            await ut.set_budget_limit(db, 10.0)
            await ut.set_budget_limit(db, None)
            return await ut.get_budget_limit(db)

    assert anyio.run(go) is None


def test_negative_budget_is_rejected() -> None:
    async def go() -> None:
        async with SessionLocal() as db:
            await ut.set_budget_limit(db, -5.0)

    with pytest.raises(ValueError):
        anyio.run(go)


def test_budget_state_ok_below_80_percent() -> None:
    async def go() -> ut.BudgetStatus:
        async with SessionLocal() as db:
            await ut.set_budget_limit(db, 10.0)
            await ut.record_usage(
                db, run_id="r", node_id="n", source="harness",
                connection_id="a", provider="anthropic", adapter="claude",
                model="claude-sonnet-5", tokens_total=100_000,  # $0.90 -> 9%
            )
            return await ut.get_budget_status(db)

    status = anyio.run(go)
    assert status.state == "ok"
    assert status.pct == pytest.approx(0.09)


def test_budget_state_warning_at_80_percent_threshold() -> None:
    async def go() -> ut.BudgetStatus:
        async with SessionLocal() as db:
            await ut.set_budget_limit(db, 10.0)
            # opus blended = 45 $/Mtok; 178,000 tok -> $8.01 -> 80.1% of $10
            await ut.record_usage(
                db, run_id="r", node_id="n", source="harness",
                connection_id="a", provider="anthropic", adapter="claude",
                model="claude-opus-5", tokens_total=178_000,
            )
            return await ut.get_budget_status(db)

    status = anyio.run(go)
    assert status.state == "warning"
    assert status.pct >= 0.8


def test_budget_state_exceeded_at_100_percent() -> None:
    async def go() -> ut.BudgetStatus:
        async with SessionLocal() as db:
            await ut.set_budget_limit(db, 1.0)
            await ut.record_usage(
                db, run_id="r", node_id="n", source="harness",
                connection_id="a", provider="anthropic", adapter="claude",
                model="claude-opus-5", tokens_total=100_000,  # $4.50
            )
            return await ut.get_budget_status(db)

    status = anyio.run(go)
    assert status.state == "exceeded"
    assert status.remaining_usd == 0.0


def test_zero_budget_blocks_everything_from_the_start() -> None:
    async def go() -> ut.BudgetStatus:
        async with SessionLocal() as db:
            await ut.set_budget_limit(db, 0)
            return await ut.get_budget_status(db)

    status = anyio.run(go)
    assert status.state == "exceeded"


def test_float_drift_does_not_erode_the_hard_stop() -> None:
    """Classic IEEE-754 drift: summing many small charges can land a hair
    under the true total instead of exactly on it (this exact value is what
    `sum([0.1] * 50)` produces on many platforms/Python builds; pinned as a
    literal here so the test does not depend on the interpreter's summation
    algorithm). A budget comparison that trusted raw `>=` here would let one
    more run slip through right at the ceiling -- exactly the kind of silent
    erosion a spending cap must not have. The status function must still
    call this exceeded, not "ok"."""
    spent = 4.999999999999998
    assert spent < 5.0  # confirms this literal actually sits just under the limit
    status = ut._status_from(5.0, spent)
    assert status.state == "exceeded"


# ── enforce_budget_or_raise: the pre-run gate ───────────────────────────────


def test_enforce_budget_allows_when_unset() -> None:
    async def go() -> ut.BudgetStatus:
        async with SessionLocal() as db:
            return await ut.enforce_budget_or_raise(db)

    status = anyio.run(go)
    assert status.state == "unset"


def test_enforce_budget_raises_when_already_exceeded() -> None:
    async def go() -> None:
        async with SessionLocal() as db:
            await ut.set_budget_limit(db, 1.0)
            await ut.record_usage(
                db, run_id="r", node_id="n", source="harness",
                connection_id="a", provider="anthropic", adapter="claude",
                model="claude-opus-5", tokens_total=100_000,  # $4.50 > $1 limit
            )
            await ut.enforce_budget_or_raise(db)

    with pytest.raises(ut.BudgetExceededError):
        anyio.run(go)


def test_enforce_budget_error_message_names_the_amounts() -> None:
    async def go() -> str:
        async with SessionLocal() as db:
            await ut.set_budget_limit(db, 2.0)
            await ut.record_usage(
                db, run_id="r", node_id="n", source="harness",
                connection_id="a", provider="anthropic", adapter="claude",
                model="claude-opus-5", tokens_total=100_000,  # $4.50
            )
            try:
                await ut.enforce_budget_or_raise(db)
            except ut.BudgetExceededError as exc:
                return str(exc)
            raise AssertionError("expected BudgetExceededError")

    message = anyio.run(go)
    assert "2.00" in message
    assert "4.50" in message


def test_enforce_budget_does_not_raise_at_warning_level() -> None:
    async def go() -> ut.BudgetStatus:
        async with SessionLocal() as db:
            await ut.set_budget_limit(db, 10.0)
            await ut.record_usage(
                db, run_id="r", node_id="n", source="harness",
                connection_id="a", provider="anthropic", adapter="claude",
                model="claude-opus-5", tokens_total=178_000,  # 80.1%
            )
            return await ut.enforce_budget_or_raise(db)

    status = anyio.run(go)
    assert status.state == "warning"


# ── enforce_budget_or_raise: unpriced-model awareness (SEC P2-4) ───────────
#
# compute_cost() honestly returns (0.0, None) for a model the catalog has no
# price for -- that arithmetic is correct and unchanged (see
# test_compute_cost_unknown_model_is_honestly_free_not_fabricated above). The
# gap SEC found is one level up: a configured budget never saw those unpriced
# tokens at all, so a run on an uncatalogued *paid* model read as free and
# was never refused. `model`/`residence` are optional so every call site
# above this that has no such info (nothing configured, or a graph with no
# provider-pinned node yet) keeps working exactly as before -- these new
# tests are additive, not a replacement for the ones above.


def test_enforce_budget_refuses_unpriced_model_on_non_local_connection_when_budget_set() -> None:
    async def go() -> None:
        async with SessionLocal() as db:
            await ut.set_budget_limit(db, 5.0)
            await ut.enforce_budget_or_raise(
                db, model="some-model-not-in-any-catalog", residence="cloud"
            )

    with pytest.raises(ut.BudgetExceededError):
        anyio.run(go)


def test_enforce_budget_error_names_the_unpriced_model() -> None:
    async def go() -> str:
        async with SessionLocal() as db:
            await ut.set_budget_limit(db, 5.0)
            try:
                await ut.enforce_budget_or_raise(db, model="z-ai/glm-4.6", residence="cloud")
            except ut.BudgetExceededError as exc:
                return str(exc)
            raise AssertionError("expected BudgetExceededError")

    message = anyio.run(go)
    assert "z-ai/glm-4.6" in message
    assert "5.00" in message


def test_enforce_budget_allows_unpriced_model_when_no_budget_configured() -> None:
    """The common case must stay unrestricted -- no budget means no gate,
    regardless of pricing knowledge."""

    async def go() -> ut.BudgetStatus:
        async with SessionLocal() as db:
            return await ut.enforce_budget_or_raise(
                db, model="some-model-not-in-any-catalog", residence="cloud"
            )

    status = anyio.run(go)
    assert status.state == "unset"


def test_enforce_budget_allows_unpriced_model_on_local_residence_even_with_budget() -> None:
    """A local/on-device model is genuinely free -- unknown price there means
    exactly that, not "can't tell", so it must never be refused."""

    async def go() -> ut.BudgetStatus:
        async with SessionLocal() as db:
            await ut.set_budget_limit(db, 5.0)
            return await ut.enforce_budget_or_raise(db, model="llama3.2", residence="local")

    status = anyio.run(go)
    assert status.state == "ok"


def test_enforce_budget_allows_priced_model_regardless_of_residence_when_budget_set() -> None:
    """A catalogued model never trips the new check -- its cost is knowable,
    so the ceiling can see it the normal way."""

    async def go() -> ut.BudgetStatus:
        async with SessionLocal() as db:
            await ut.set_budget_limit(db, 5.0)
            return await ut.enforce_budget_or_raise(db, model="claude-sonnet-5", residence="cloud")

    status = anyio.run(go)
    assert status.state == "ok"


def test_enforce_budget_allows_unpriced_model_when_model_unknown() -> None:
    """A caller with no model info at all (model=None, the default) must not
    be newly restricted -- this is the existing pre-P2-4 call shape every
    other test in this file above already exercises."""

    async def go() -> ut.BudgetStatus:
        async with SessionLocal() as db:
            await ut.set_budget_limit(db, 5.0)
            return await ut.enforce_budget_or_raise(db)

    status = anyio.run(go)
    assert status.state == "ok"


def test_enforce_budget_refuses_an_empty_model_when_the_caller_already_resolved(
) -> None:
    """QA re-review, 2026-09-15: a CLI adapter with no defaultModel configured
    resolves to an empty model string -- OpenAI connections hit this
    routinely. `model_expected=True` (only `engine.py`'s per-node call, past
    a real resolve_node_provider() success, passes this) must treat that as
    the least-known case there is, not skip the check entirely the way the
    pre-run "nothing resolved yet" callers correctly do."""

    async def go() -> ut.BudgetStatus:
        async with SessionLocal() as db:
            await ut.set_budget_limit(db, 5.0)
            return await ut.enforce_budget_or_raise(
                db, model="", residence="cloud", model_expected=True
            )

    with pytest.raises(ut.BudgetExceededError, match="no default model"):
        anyio.run(go)


def test_enforce_budget_still_allows_empty_model_on_a_local_connection() -> None:
    """The local-residence exemption survives model_expected=True -- an
    on-device connection with no model resolved yet is still genuinely
    free, not merely unknown."""

    async def go() -> ut.BudgetStatus:
        async with SessionLocal() as db:
            await ut.set_budget_limit(db, 5.0)
            return await ut.enforce_budget_or_raise(
                db, model="", residence="local", model_expected=True
            )

    status = anyio.run(go)
    assert status.state == "ok"
