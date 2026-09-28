"""Regression/BDD for the production selection of real versus simulated runs."""
import asyncio
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from adapters.base import AgentAdapter, AdapterResult
from automations.scheduler import AutomationScheduler, run_job
from database import Base
from models import AutomationJob, CoworkProject
from secret_store.memory import MemorySecrets


@pytest.mark.parametrize("trigger", ["manual-default", "scheduled-default", "explicit-mock"])
def test_given_configured_job_when_triggered_then_only_explicit_mock_skips_provider(tmp_path, monkeypatch, trigger):
    calls = []

    class Provider(AgentAdapter):
        async def invoke(self, prompt, config):
            calls.append((prompt, config.extra["cwd"]))
            return AdapterResult(content="real scheduled output", tokens_used=11)

        async def stream(self, prompt, config):
            yield "real scheduled output"

    monkeypatch.setattr("providers.resolution.get_adapter", lambda name: Provider())
    state = SimpleNamespace(provider_connections={
        "chosen": {"id": "chosen", "provider": "anthropic", "enabled": True},
    }, secrets_store=MemorySecrets())

    async def exercise():
        engine = create_async_engine(f"sqlite+aiosqlite:///{(tmp_path / 'jobs.db').as_posix()}")
        sessions = async_sessionmaker(engine, expire_on_commit=False)
        try:
            async with engine.begin() as connection:
                await connection.run_sync(Base.metadata.create_all)
            async with sessions() as db:
                db.add(CoworkProject(id="workspace", name="Fixture", root_path=str(tmp_path)))
                db.add(AutomationJob(id="job", name="Fixture job", instruction="run saved instruction",
                                     connection_id="chosen", project_id="workspace", harness_enabled=False,
                                     cron="7 3 9 9 *"))
                await db.commit()
            if trigger == "scheduled-default":
                scheduler = AutomationScheduler(sessions, app_state=state,
                    now_fn=lambda: datetime(2026, 9, 9, 3, 7, tzinfo=timezone.utc))
                assert await scheduler.tick() == ["job"]
                assert await scheduler.tick() == []
            else:
                async with sessions() as db:
                    kwargs = {"mode": "mock"} if trigger == "explicit-mock" else {}
                    result = await run_job(db, "job", connections=state.provider_connections,
                                           secrets_store=state.secrets_store, **kwargs)
                    assert result.status == "complete"
                    assert result._last_result["mode"] == ("mock" if kwargs else "live")
                    if not kwargs:
                        assert result._last_result["output"] == "real scheduled output"
            assert calls == ([] if trigger == "explicit-mock" else [("run saved instruction", str(tmp_path.resolve()))])
        finally:
            await engine.dispose()

    asyncio.run(exercise())
