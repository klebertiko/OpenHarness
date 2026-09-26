"""In-process automation scheduler — asyncio loop + real/mock execute.

`run_job`/`AutomationScheduler` default to **real** execution (`real_execute`,
below) — reaching an actual adapter through the same resolver/budget/cwd/
ledger primitives `routers/execution.py` uses for chat and Studio runs, never
a silent `mock_execute` fallback. `mock_execute` still exists and is still
reachable (an explicit `mode="mock"` request, or an explicit `execute_fn`
override, e.g. in tests) as the genuine, honestly-labeled, free simulate
path — it just isn't the unconditional default it used to be. See
`real_execute`'s docstring for exactly what "real" means for a harness-
enabled vs. a Direct (no harness) job."""

from __future__ import annotations

import asyncio
import json
import uuid
from datetime import datetime, timezone
from typing import Any, Awaitable, Callable

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from engine import execute_harness
from models import AutomationJob, AutomationRun, CoworkProject, Harness
from providers.outcomes import failure_details
from providers.resolution import ProviderResolutionError, resolve_node_provider
import usage_tracking
from usage_tracking import BudgetExceededError
from routers.execution import (
    _enforce_node_budget,
    _parse_sse_chunk,
    _usage_rows_from_events,
    _validated_project_cwd,
)

ExecuteFn = Callable[[AutomationJob], Awaitable[dict[str, Any]]]
NowFn = Callable[[], datetime]


class InvalidCwdError(Exception):
    """The job's configured project directory can no longer be validated
    (deleted, renamed, or no longer resolves to a real directory on disk).
    Every other real-execution surface in this app (`_validated_project_cwd`
    itself) silently degrades an unresolvable cwd to `None` rather than
    erroring — the right call for an interactive chat/Studio session, where
    a person notices immediately. An unattended automation is different: it
    could otherwise silently run in the wrong workspace (or no workspace at
    all) with nobody watching, so a job that named a project must either get
    that exact, still-valid project or an honest failure — never a silent
    downgrade to "no cwd"."""


class HarnessRunFailedError(Exception):
    """The harness graph itself reported a node failure (a `node_error`
    event) rather than `execute_harness` raising — `details` is that event's
    own data dict, already `failure_details()`-shaped when the failure came
    from a real adapter call (see `engine.py`'s node loop). Wrapping it here
    lets `run_job`'s except-block surface every real-execution failure
    (direct or harness) through one path, `_automation_failure_details`,
    without re-deriving anything `engine.py` already computed."""

    def __init__(self, message: str, *, details: dict | None = None):
        super().__init__(message)
        self.details = details or {}


def cron_matches(expr: str, dt: datetime) -> bool:
    """Match a 5-field cron (minute hour day-of-month month day-of-week)."""
    parts = expr.strip().split()
    if len(parts) != 5:
        return False
    minute, hour, dom, month, dow = parts
    # cron dow: 0=Sunday … 6=Saturday; Python weekday(): 0=Monday … 6=Sunday
    py_dow = (dt.weekday() + 1) % 7
    return (
        _field_matches(minute, dt.minute)
        and _field_matches(hour, dt.hour)
        and _field_matches(dom, dt.day)
        and _field_matches(month, dt.month)
        and _field_matches(dow, py_dow)
    )


def _field_matches(field: str, value: int) -> bool:
    if field == "*":
        return True
    for part in field.split(","):
        part = part.strip()
        if part.startswith("*/"):
            try:
                step = int(part[2:])
            except ValueError:
                return False
            if step > 0 and value % step == 0:
                return True
        elif "-" in part:
            try:
                lo, hi = part.split("-", 1)
                if int(lo) <= value <= int(hi):
                    return True
            except ValueError:
                return False
        else:
            try:
                if int(part) == value:
                    return True
            except ValueError:
                return False
    return False


async def mock_execute(job: AutomationJob) -> dict[str, Any]:
    """Stand-in for Agent execute pipeline — records harness flag.

    Jobs named ``pr_watch`` / ``pr_watch:...`` optionally poll FakeRepoProvider.
    """
    from automations.pr_watch import is_pr_watch_job, stub_pr_watch
    from repos.fake import FakeRepoProvider

    base = {
        "ok": True,
        "mode": "mock",
        "harnessEnabled": bool(job.harness_enabled),
        "jobId": job.id,
        "jobName": job.name,
    }
    if is_pr_watch_job(job.name):
        # Optional stub: poll open pulls; repo from name suffix ``pr_watch:owner/name``.
        repo = "acme/app"
        if ":" in job.name:
            maybe = job.name.split(":", 1)[1].strip()
            if maybe:
                repo = maybe
        watch = await stub_pr_watch(FakeRepoProvider(), repo)
        return {**base, "prWatch": watch}
    return base


async def _resolve_job_cwd(db: AsyncSession, job: AutomationJob) -> str | None:
    """Turn `job.project_id` into a validated cwd the same way
    `routers/execution.py`'s `_validated_project_cwd` does for chat/Studio —
    reused unchanged, not reinvented. That function keys off a project's
    `root_path`, while a job only stores the project's id, so the id is
    resolved to its `root_path` first. No `project_id` at all means "no
    workspace pinned" (`None`, same as every other real-execution surface);
    a `project_id` that no longer resolves to a real, existing project is an
    honest `InvalidCwdError` instead — see that class's docstring for why
    automations don't get the same silent-degrade-to-None treatment chat
    does."""
    if not job.project_id:
        return None
    project = await db.get(CoworkProject, job.project_id)
    if project is None or not project.root_path:
        raise InvalidCwdError(
            f"This job's project ('{job.project_id}') no longer exists. "
            "Re-select the project under this job's settings."
        )
    cwd = await _validated_project_cwd(db, project.root_path)
    if cwd is None:
        raise InvalidCwdError(
            f"This job's project directory ('{project.root_path}') could not "
            "be validated on disk. Re-select the project under this job's "
            "settings."
        )
    return cwd


async def real_execute(
    job: AutomationJob,
    *,
    db: AsyncSession,
    connections: dict[str, dict] | None,
    secrets_store: Any,
    run_id: str,
) -> dict[str, Any]:
    """Reach a real adapter for this job — no silent mock fallback.

    Two shapes, mirroring `routers/execution.py`'s own split:

    * **Harness-enabled** (`job.harness_enabled` + `job.harness_bundle_id`):
      loads that `Harness`'s graph and walks it with `engine.execute_harness`
      exactly like `POST /execute/` does, budget-gated per node via the
      reused `_enforce_node_budget` callback. The graph's own `input` node
      already carries the stored prompt — same as any other harness run —
      so no instruction is threaded in here.
    * **Direct** (no harness): needs `job.instruction` + `job.connection_id`
      (added in this story's piece 2) to resolve a connection via
      `resolve_node_provider` and invoke it once, budget-gated the same way
      `POST /execute/direct` gates a single real turn.

    Every failure here is an honest exception (`ProviderResolutionError`,
    `BudgetExceededError`, `InvalidCwdError`, `HarnessRunFailedError`, or
    whatever the adapter itself raises) — this function never swallows one
    and never substitutes mock output; `run_job`'s caller is what decides
    what a caught exception means for the job/run records
    (`_automation_failure_details`)."""
    cwd = await _resolve_job_cwd(db, job)

    if job.harness_enabled:
        if not job.harness_bundle_id:
            raise ProviderResolutionError(
                "This job is harness-enabled but no harness is selected. "
                "Choose one under this job's settings and save."
            )
        harness = await db.get(Harness, job.harness_bundle_id)
        if harness is None:
            raise ProviderResolutionError(
                f"Harness '{job.harness_bundle_id}' no longer exists. Choose "
                "a different one under this job's settings."
            )
        graph = json.loads(harness.graph_json)
        events: list[dict] = []
        status = "error"
        async for chunk in execute_harness(
            graph,
            execution_mode="live",
            run_id=run_id,
            connections=connections,
            secrets_store=secrets_store,
            cwd=cwd,
            enforce_budget=_enforce_node_budget,
        ):
            parsed = _parse_sse_chunk(chunk)
            if parsed:
                events.append(parsed)
                if parsed["event"] == "harness_done":
                    status = parsed["data"].get("status", "complete")

        usage_rows = _usage_rows_from_events(
            events, run_id=run_id, source="automation", connections=connections
        )
        await usage_tracking.record_usage_rows(db, usage_rows)

        if status != "complete":
            node_errors = [e["data"] for e in events if e["event"] == "node_error"]
            detail = node_errors[0] if node_errors else {"error": f"Harness run ended with status '{status}'."}
            raise HarnessRunFailedError(detail.get("error", "Harness run failed."), details=detail)

        return {
            "ok": True,
            "mode": "live",
            "harnessEnabled": True,
            "jobId": job.id,
            "jobName": job.name,
            "status": status,
            "events": events,
        }

    # Direct mode — no harness graph, so nothing to run without an explicit
    # instruction. This is a genuine data-model gap today (piece 2 of this
    # story), not a bug in this function: until AutomationJob carries an
    # instruction/connection, every Direct job honestly has nothing to
    # execute for real, exactly like an unpinned harness node has no
    # provider to resolve — same exception type, same reasoning.
    instruction = (getattr(job, "instruction", None) or "").strip()
    if not instruction:
        raise ProviderResolutionError(
            "This job has no instruction to run. Add one under this job's "
            "settings, or enable a harness with a selected bundle."
        )

    connection_id = getattr(job, "connection_id", None)
    resolved = resolve_node_provider(
        {"providerIds": [connection_id] if connection_id else []},
        "automation",
        job.name,
        connections=connections,
        secrets_store=secrets_store,
        cwd=cwd,
    )
    await usage_tracking.enforce_budget_or_raise(
        db,
        model=resolved.config.model or None,
        residence=(connections or {}).get(resolved.connection_id, {}).get("residence"),
        model_expected=True,
    )
    # No try/except here: an adapter exception propagates to run_job's own
    # except-block unchanged, where _automation_failure_details classifies it
    # (auth/transport via the reused failure_details, same as everywhere else
    # a real adapter call can fail).
    result = await resolved.adapter.invoke(instruction, resolved.config)
    if result.tokens_used > 0:
        await usage_tracking.record_usage(
            db,
            run_id=run_id,
            node_id="automation",
            source="automation",
            connection_id=resolved.connection_id,
            provider=(connections or {}).get(resolved.connection_id, {}).get("provider", ""),
            adapter=resolved.adapter_name,
            model=resolved.config.model,
            tokens_total=result.tokens_used,
        )
    return {
        "ok": True,
        "mode": "live",
        "harnessEnabled": False,
        "jobId": job.id,
        "jobName": job.name,
        "output": result.content,
        "tokens": result.tokens_used,
        "adapter": resolved.adapter_name,
        "connectionId": resolved.connection_id,
    }


def _automation_failure_details(exc: Exception) -> dict[str, str]:
    """Structured, actionable failure for a run record / job result — reuses
    `providers.outcomes.failure_details`'s auth/transport classification
    (the same vocabulary `routers/execution.py` surfaces on a `node_error`)
    rather than a bare `str(exc)`, and adds the automation-specific cases
    `failure_details` has no reason to know about. `failure` is always one
    of: authentication | transport | budget-exceeded | unresolved-connection
    | invalid-cwd | unknown.

    `HarnessRunFailedError` is the one asymmetric case: by the time a
    harness-graph node fails, the original exception is already gone --
    `engine.py`'s node loop caught it and only yielded a `node_error` SSE
    event, never re-raised it (see that module's node loop). So this can
    only classify as precisely as that event's own data lets it: a real
    adapter failure already carries `provider_failure` (`failure_details`'s
    own key, passed straight through); a budget refusal's message always
    contains the word "budget" (`usage_tracking.BudgetExceededError`'s own
    messages, every one of them — the same substring this app's own tests
    already key off, e.g. test_execution_budget_enforcement.py); anything
    else honestly falls to "unknown" rather than guessing."""
    if isinstance(exc, BudgetExceededError):
        return {"failure": "budget-exceeded", "error": str(exc)}
    if isinstance(exc, ProviderResolutionError):
        return {"failure": "unresolved-connection", "error": str(exc)}
    if isinstance(exc, InvalidCwdError):
        return {"failure": "invalid-cwd", "error": str(exc)}
    if isinstance(exc, HarnessRunFailedError):
        provider_failure = exc.details.get("provider_failure")
        error = exc.details.get("error", str(exc))
        if provider_failure == "authentication":
            return {"failure": "authentication", "error": error}
        if provider_failure == "transport":
            return {"failure": "transport", "error": error}
        if "budget" in error.lower():
            return {"failure": "budget-exceeded", "error": error}
        return {"failure": "unknown", "error": error}
    details = failure_details(exc)
    failure = details.pop("provider_failure", None) or "unknown"
    return {"failure": failure, **details}


async def run_job(
    db: AsyncSession,
    job_id: str,
    *,
    execute_fn: ExecuteFn | None = None,
    mode: str = "live",
    connections: dict[str, dict] | None = None,
    secrets_store: Any = None,
) -> AutomationJob:
    """Mark job running -> real (default) or mock execute -> complete;
    updates last_run_at and writes a persisted `AutomationRun` row (piece 4
    -- run history used to live only on the in-memory `job._last_result`,
    lost on every restart).

    `execute_fn`, when given, always wins -- the existing seam tests use to
    pin exact behavior (e.g. `capture_execute` in
    `test_scheduler_tick_fires_cron_job_once`) -- unaffected by `mode`.
    Otherwise `mode` picks `real_execute` ("live", the default -- reaches a
    real adapter, see that function's docstring) or `mock_execute` ("mock" --
    the explicit, honestly-labeled, free simulate path). Neither
    `mock_execute` nor `real_execute` is ever chosen silently on the other's
    behalf."""
    job = await db.get(AutomationJob, job_id)
    if job is None:
        raise KeyError(job_id)
    job.status = "running"
    await db.commit()
    await db.refresh(job)

    run_id = str(uuid.uuid4())
    # `mode` is recorded as requested regardless of an `execute_fn` override
    # (tests pass their own callable without caring what lands in this
    # column) -- the honesty gate this run row exists for is about
    # distinguishing real from mock results on real production call sites,
    # not about tests that already fully control their own execute_fn.
    run = AutomationRun(id=run_id, job_id=job.id, mode=mode, status="running")
    db.add(run)
    await db.commit()

    if execute_fn is not None:
        fn = execute_fn
    elif mode == "mock":
        fn = mock_execute
    else:
        async def fn(j: AutomationJob) -> dict[str, Any]:
            return await real_execute(j, db=db, connections=connections, secrets_store=secrets_store, run_id=run_id)
    try:
        result = await fn(job)
        job.status = "complete"
        job.last_run_at = datetime.now(timezone.utc).replace(tzinfo=None)
        run.status = "complete"
        run.result_json = json.dumps(result)
        run.finished_at = job.last_run_at
        # stash last result on the instance for API response (not persisted)
        job._last_result = result  # type: ignore[attr-defined]
    except Exception as exc:  # noqa: BLE001 — surface as job error status
        job.status = "error"
        job.last_run_at = datetime.now(timezone.utc).replace(tzinfo=None)
        failure = _automation_failure_details(exc)
        job._last_result = {"ok": False, "mode": mode, **failure}  # type: ignore[attr-defined]
        run.status = "error"
        run.error_json = json.dumps(failure)
        run.finished_at = job.last_run_at
    job.updated_at = datetime.now(timezone.utc).replace(tzinfo=None)
    await db.commit()
    await db.refresh(job)
    return job


class AutomationScheduler:
    """Polls cron jobs and fires real execution by default. One fire per
    (job, minute). `execute_fn`, when given, still wins outright (tests pin
    exact cron-fire behavior this way, e.g.
    `test_scheduler_tick_fires_cron_job_once`'s `capture_execute`) — the
    default with no override is no longer a hardcoded `mock_execute`, it is
    `mode`-driven real execution via `run_job`, the same change made to
    `run_job` itself. `app_state` is the live `FastAPI().state` (not a
    snapshot): `provider_connections`/`secrets_store` are read fresh off it
    on every tick, mirroring how `routers/execution.py` reads
    `request.app.state` fresh on every HTTP call, so a connection added or
    edited after startup is honored on the very next tick rather than
    needing a restart."""

    def __init__(
        self,
        session_factory: async_sessionmaker[AsyncSession],
        *,
        execute_fn: ExecuteFn | None = None,
        now_fn: NowFn | None = None,
        poll_seconds: float = 15.0,
        app_state: Any = None,
        mode: str = "live",
    ):
        self.session_factory = session_factory
        self.execute_fn = execute_fn
        self.now_fn = now_fn or (lambda: datetime.now(timezone.utc))
        self.poll_seconds = poll_seconds
        self.app_state = app_state
        self.mode = mode
        self._task: asyncio.Task | None = None
        self._running = False
        self._fired: set[tuple[str, str]] = set()  # (job_id, YYYYMMDDHHMM)

    async def tick(self) -> list[str]:
        now = self.now_fn()
        if now.tzinfo is None:
            now = now.replace(tzinfo=timezone.utc)
        minute_key = now.strftime("%Y%m%d%H%M")
        fired: list[str] = []
        connections = getattr(self.app_state, "provider_connections", None)
        secrets_store = getattr(self.app_state, "secrets_store", None)
        async with self.session_factory() as db:
            result = await db.execute(
                select(AutomationJob).where(AutomationJob.cron.is_not(None))
            )
            jobs = list(result.scalars().all())
            for job in jobs:
                if not job.cron:
                    continue
                if not cron_matches(job.cron, now):
                    continue
                key = (job.id, minute_key)
                if key in self._fired:
                    continue
                await run_job(
                    db,
                    job.id,
                    execute_fn=self.execute_fn,
                    mode=self.mode,
                    connections=connections,
                    secrets_store=secrets_store,
                )
                self._fired.add(key)
                fired.append(job.id)
        # prune old minute keys (keep last ~2 hours)
        if len(self._fired) > 500:
            self._fired = {k for k in self._fired if k[1] >= minute_key[:10]}
        return fired

    async def _loop(self) -> None:
        while self._running:
            try:
                await self.tick()
            except Exception:
                pass
            await asyncio.sleep(self.poll_seconds)

    def start(self) -> None:
        if self._running:
            return
        self._running = True
        self._task = asyncio.create_task(self._loop())

    async def stop(self) -> None:
        self._running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None
