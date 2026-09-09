"""In-process automation scheduler — asyncio loop + mock execute."""

from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from typing import Any, Awaitable, Callable

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from models import AutomationJob

ExecuteFn = Callable[[AutomationJob], Awaitable[dict[str, Any]]]
NowFn = Callable[[], datetime]


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


async def run_job(
    db: AsyncSession,
    job_id: str,
    *,
    execute_fn: ExecuteFn | None = None,
) -> AutomationJob:
    """Mark job running → mock execute → complete; updates last_run_at."""
    job = await db.get(AutomationJob, job_id)
    if job is None:
        raise KeyError(job_id)
    job.status = "running"
    await db.commit()
    await db.refresh(job)

    fn = execute_fn or mock_execute
    try:
        result = await fn(job)
        job.status = "complete"
        job.last_run_at = datetime.now(timezone.utc).replace(tzinfo=None)
        # stash last result on the instance for API response (not persisted)
        job._last_result = result  # type: ignore[attr-defined]
    except Exception as exc:  # noqa: BLE001 — surface as job error status
        job.status = "error"
        job.last_run_at = datetime.now(timezone.utc).replace(tzinfo=None)
        job._last_result = {"ok": False, "error": str(exc)}  # type: ignore[attr-defined]
    job.updated_at = datetime.now(timezone.utc).replace(tzinfo=None)
    await db.commit()
    await db.refresh(job)
    return job


class AutomationScheduler:
    """Polls cron jobs and fires mock execute. One fire per (job, minute)."""

    def __init__(
        self,
        session_factory: async_sessionmaker[AsyncSession],
        *,
        execute_fn: ExecuteFn | None = None,
        now_fn: NowFn | None = None,
        poll_seconds: float = 15.0,
    ):
        self.session_factory = session_factory
        self.execute_fn = execute_fn or mock_execute
        self.now_fn = now_fn or (lambda: datetime.now(timezone.utc))
        self.poll_seconds = poll_seconds
        self._task: asyncio.Task | None = None
        self._running = False
        self._fired: set[tuple[str, str]] = set()  # (job_id, YYYYMMDDHHMM)

    async def tick(self) -> list[str]:
        now = self.now_fn()
        if now.tzinfo is None:
            now = now.replace(tzinfo=timezone.utc)
        minute_key = now.strftime("%Y%m%d%H%M")
        fired: list[str] = []
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
                await run_job(db, job.id, execute_fn=self.execute_fn)
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
