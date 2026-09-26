import uuid
from datetime import datetime
from sqlalchemy import String, DateTime, Text, Boolean, Float, Integer, func
from sqlalchemy.orm import Mapped, mapped_column
from database import Base


class Harness(Base):
    __tablename__ = "harnesses"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str] = mapped_column(Text, default="")
    graph_json: Mapped[str] = mapped_column(Text, nullable=False)  # nodes + edges as JSON
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())


class ExecutionLog(Base):
    __tablename__ = "execution_logs"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    harness_id: Mapped[str] = mapped_column(String, nullable=False)
    harness_name: Mapped[str] = mapped_column(String(255), nullable=False)
    status: Mapped[str] = mapped_column(String(50), default="running")  # running, complete, error
    result_json: Mapped[str] = mapped_column(Text, default="{}")
    started_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    finished_at: Mapped[datetime] = mapped_column(DateTime, nullable=True)


class ProviderConnection(Base):
    """Durable twin of the `app.state.provider_connections` runtime dict
    (`routers/providers.py`). That dict was in-memory only — every sidecar
    restart silently wiped every connection while the frontend kept showing
    stale "connected" status for them (surfaced live, 2026-09-12: a green
    dot on a provider the backend had already forgotten, "Connection was
    not found" on the next real send). This table is the source of truth;
    the in-memory dict is now just a hydration of it, kept for the read-path
    call sites that already expect a plain dict."""

    __tablename__ = "provider_connections"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    provider: Mapped[str] = mapped_column(String(64), nullable=False)
    label: Mapped[str] = mapped_column(String(255), nullable=False)
    residence: Mapped[str] = mapped_column(String(16), nullable=False)
    endpoint: Mapped[str] = mapped_column(String(1024), default="")
    enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    secret_ref: Mapped[str | None] = mapped_column(String(255), nullable=True)
    default_model: Mapped[str] = mapped_column(String(255), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())


class CoworkProject(Base):
    __tablename__ = "cowork_projects"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    root_path: Mapped[str] = mapped_column(String(1024), default="")
    instructions: Mapped[str] = mapped_column(Text, default="")
    memory_json: Mapped[str] = mapped_column(Text, default="{}")
    harness_bundle_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    harness_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())


class AutomationJob(Base):
    __tablename__ = "automation_jobs"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    cron: Mapped[str | None] = mapped_column(String(128), nullable=True)
    project_id: Mapped[str | None] = mapped_column(String, nullable=True)
    harness_bundle_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    harness_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    # Direct-mode (harness_enabled=False) action definition — a harness-
    # enabled job needs neither: the harness graph's own `input` node already
    # carries a stored prompt, exactly like a normal harness run. Without
    # these, a Direct job has nothing for real execution to run at all
    # (automations/scheduler.py's `real_execute` raises ProviderResolutionError
    # honestly when either is missing, rather than silently mocking).
    instruction: Mapped[str | None] = mapped_column(Text, nullable=True)
    connection_id: Mapped[str | None] = mapped_column(String, nullable=True)
    status: Mapped[str] = mapped_column(String(50), default="idle")  # idle | running | complete | error
    last_run_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())


class AutomationRun(Base):
    """One row per `run_job` attempt (on-demand `/run` or cron-fired) —
    the persisted counterpart to what used to live only on
    `AutomationJob._last_result`, an in-memory instance attribute the
    `scheduler.py` code used to mark explicitly "not persisted": a restart
    lost every result detail and there was never more than one attempt's
    worth of history to inspect. `mode` ("live" | "mock") is stored
    per-row, not inferred from `result_json`/`error_json`, so a run's
    real-vs-simulated status is always visible even before either payload
    is parsed — the honesty gate this story's Automate work must hold
    end to end (`.gauntlet/automate-recovery.md` AC1): a mock run's history
    row must never be mistakable for a real one from its timestamp alone.
    `result_json`/`error_json` are mutually exclusive in practice (a run
    either completes or fails) but both nullable rather than one enforced
    over the other, mirroring `ExecutionLog`'s own `result_json` shape."""

    __tablename__ = "automation_runs"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    job_id: Mapped[str] = mapped_column(String, nullable=False)
    mode: Mapped[str] = mapped_column(String(16), default="live")  # live | mock
    status: Mapped[str] = mapped_column(String(50), default="running")  # running | complete | error
    result_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    error_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    started_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    finished_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class UsageRecord(Base):
    """One row per completed node/turn that actually reached a real vendor —
    the durable source of truth for tokens spent and USD cost, written once
    a run's outcome is already known (`routers/execution.py`'s
    `event_stream()` finally-block, alongside the existing `ExecutionLog`
    write; never speculatively, never from the frontend's own say-so).

    `cost_usd` and `price_per_mtok` are computed and frozen at write time
    from the catalog price *then in effect* (`adapters/catalog.py`'s
    `MODEL_PRICES`) — a later catalog price change must never retroactively
    rewrite what a past run actually cost. `price_per_mtok` is the *blended*
    rate — average of the catalog's [input, output] $/Mtok — because the
    adapter layer only ever reports one combined token count per turn today
    (see `adapters/base.py`'s `usage` SSE event shape); there is no real
    input/output split available to price exactly. `price_per_mtok is None`
    means this model's price is not in the catalog (mock mode, or a real
    model this catalog doesn't know the price of yet) — never conflate that
    with "genuinely free": a local/on-device model reads that way too, and
    the two are told apart by the caller via the connection's `residence`,
    not by anything stored on this row.

    A row is only ever written for real spend: `usage_tracking.record_usage`
    refuses `tokens_total <= 0` and the `mock`/`unresolved` adapters outright,
    so this table is real-usage-only by construction — never a place a
    synthetic/demo number could leak into the Providers screen's totals.
    """

    __tablename__ = "usage_records"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    run_id: Mapped[str] = mapped_column(String, nullable=False)
    node_id: Mapped[str | None] = mapped_column(String, nullable=True)
    source: Mapped[str] = mapped_column(String(16), default="harness")  # harness | direct
    connection_id: Mapped[str | None] = mapped_column(String, nullable=True)
    provider: Mapped[str] = mapped_column(String(64), default="")
    adapter: Mapped[str] = mapped_column(String(64), default="")
    model: Mapped[str] = mapped_column(String(255), default="")
    tokens_total: Mapped[int] = mapped_column(Integer, default=0)
    price_per_mtok: Mapped[float | None] = mapped_column(Float, nullable=True)
    cost_usd: Mapped[float] = mapped_column(Float, default=0.0)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


class BudgetConfig(Base):
    """Singleton row (id='global') — the one overall USD ceiling covering
    every real spend path this app has *today*: chat (the triage/intake
    call), harness runs, and direct turns, regardless of agent or provider
    (`usage_tracking.enforce_budget_or_raise` is the one gate every one of
    them calls before it starts). `limit_usd is None` means unset — no
    budget enforced, and the UI must say so plainly rather than defaulting
    to a fabricated number.

    Automations are **not** covered (SEC P3-4, 2026-09-15, corrected here —
    this docstring previously claimed they were). `automations/scheduler.py`'s
    `run_job`/`AutomationScheduler` accept an injectable `execute_fn`, but
    every production call site (`main.py`'s scheduler construction,
    `routers/automations.py`'s `/{job_id}/run` endpoint) currently passes
    none, so both the cron-fired and on-demand paths always run
    `mock_execute` — no adapter is ever invoked, so there is no real spend
    yet for this ceiling to miss. Pinned by
    `tests/test_scheduler.py::test_run_now_ignores_an_exhausted_budget`
    (a $0 budget does not block a run today) precisely so that changes when
    a real executor is ever wired in: that wiring must call
    `usage_tracking.enforce_budget_or_raise` the same way
    `routers/execution.py` already does for every other real-spend path
    *before* this docstring can honestly list "automations" again.
    """

    __tablename__ = "budget_config"

    id: Mapped[str] = mapped_column(String, primary_key=True, default="global")
    limit_usd: Mapped[float | None] = mapped_column(Float, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())
