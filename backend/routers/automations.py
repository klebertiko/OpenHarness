"""Automations / Schedules — on-demand and cron jobs with optional harness."""

from __future__ import annotations

import re
import uuid
from datetime import datetime, timezone
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import AfterValidator, BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from automations.scheduler import run_job
from database import get_db
from models import AutomationJob

router = APIRouter(prefix="/automations", tags=["automations"])


def _job_name(value: str) -> str:
    value = value.strip()
    if not value:
        raise ValueError("Name must not be blank")
    return value


def _cron_expression(value: str) -> str:
    fields = value.split()
    bounds = [(0, 59), (0, 23), (1, 31), (1, 12), (0, 6)]
    if len(fields) != 5:
        raise ValueError("Use five cron fields in UTC")
    for field, (minimum, maximum) in zip(fields, bounds):
        if field == "*":
            continue
        for term in field.split(","):
            if re.fullmatch(r"\*/[0-9]+", term) and int(term[2:]) > 0:
                continue
            if not re.fullmatch(r"[0-9]+(?:-[0-9]+)?", term):
                raise ValueError("Cron supports numbers, lists, ranges and */positive-step")
            numbers = [int(number) for number in term.split("-")]
            if not minimum <= numbers[0] <= numbers[-1] <= maximum:
                raise ValueError(f"Cron field must stay within {minimum}–{maximum}")
    return " ".join(fields)


JobName = Annotated[str, AfterValidator(_job_name)]
CronExpression = Annotated[str, AfterValidator(_cron_expression)]


class JobCreate(BaseModel):
    name: JobName
    cron: CronExpression | None = None
    projectId: str | None = None
    harnessBundleId: str | None = None
    harnessEnabled: bool = False
    # Direct-mode (harnessEnabled=False) action definition — see
    # models.AutomationJob's docstring comment for why a harness-enabled job
    # doesn't need either of these.
    instruction: str | None = None
    connectionId: str | None = None


class JobUpdate(BaseModel):
    name: JobName | None = None
    cron: CronExpression | None = None
    projectId: str | None = None
    harnessBundleId: str | None = None
    harnessEnabled: bool | None = None
    instruction: str | None = None
    connectionId: str | None = None


class RunRequest(BaseModel):
    """Body for POST /{job_id}/run. `mode` mirrors the same field on
    `ExecuteRequest`/`DirectRequest` (routers/execution.py) — "live" reaches
    a real adapter (the default: this endpoint is the "Run now" action, and
    both fetched competitor bars for this story treat a manual/on-demand run
    as genuinely real, not a simulation — n8n's manual Execute Workflow
    explicitly is; Zapier's Test pulls real sample data), "mock" is the
    explicit, honest, free simulate/test path — see
    automations/scheduler.py's real_execute vs. mock_execute."""

    mode: str = "live"


def public_job(job: AutomationJob, *, result: dict[str, Any] | None = None) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "id": job.id,
        "name": job.name,
        "cron": job.cron,
        "projectId": job.project_id,
        "harnessBundleId": job.harness_bundle_id,
        "harnessEnabled": job.harness_enabled,
        "instruction": job.instruction,
        "connectionId": job.connection_id,
        "lastRunAt": job.last_run_at.isoformat() if job.last_run_at else None,
        "status": job.status,
    }
    if result is not None:
        payload["result"] = result
    elif hasattr(job, "_last_result"):
        payload["result"] = getattr(job, "_last_result")
    return payload


@router.get("/")
async def list_jobs(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(AutomationJob).order_by(AutomationJob.updated_at.desc()))
    return {"jobs": [public_job(j) for j in result.scalars().all()]}


@router.post("/", status_code=201)
async def create_job(body: JobCreate, db: AsyncSession = Depends(get_db)):
    job = AutomationJob(
        id=str(uuid.uuid4()),
        name=body.name,
        cron=body.cron,
        project_id=body.projectId,
        harness_bundle_id=body.harnessBundleId,
        harness_enabled=body.harnessEnabled,
        instruction=body.instruction,
        connection_id=body.connectionId,
        status="idle",
    )
    db.add(job)
    await db.commit()
    await db.refresh(job)
    return public_job(job)


@router.get("/{job_id}")
async def get_job(job_id: str, db: AsyncSession = Depends(get_db)):
    job = await db.get(AutomationJob, job_id)
    if not job:
        raise HTTPException(404, "Job not found")
    return public_job(job)


@router.put("/{job_id}")
async def update_job(job_id: str, body: JobUpdate, db: AsyncSession = Depends(get_db)):
    job = await db.get(AutomationJob, job_id)
    if not job:
        raise HTTPException(404, "Job not found")
    if body.name is not None:
        job.name = body.name
    if "cron" in body.model_fields_set:
        job.cron = body.cron
    if "projectId" in body.model_fields_set:
        job.project_id = body.projectId
    if "harnessBundleId" in body.model_fields_set:
        job.harness_bundle_id = body.harnessBundleId
    if body.harnessEnabled is not None:
        job.harness_enabled = body.harnessEnabled
    if "instruction" in body.model_fields_set:
        job.instruction = body.instruction
    if "connectionId" in body.model_fields_set:
        job.connection_id = body.connectionId
    job.updated_at = datetime.now(timezone.utc).replace(tzinfo=None)
    await db.commit()
    await db.refresh(job)
    return public_job(job)


@router.delete("/{job_id}", status_code=204)
async def delete_job(job_id: str, db: AsyncSession = Depends(get_db)):
    job = await db.get(AutomationJob, job_id)
    if not job:
        raise HTTPException(404, "Job not found")
    await db.delete(job)
    await db.commit()
    return None


@router.post("/{job_id}/run")
async def run_now(job_id: str, request: Request, body: RunRequest | None = None, db: AsyncSession = Depends(get_db)):
    """On-demand run — always available, independent of cron.

    `body` is optional so a bare `POST .../run` (no JSON body at all) keeps
    working exactly as before; it now defaults to `mode="live"` (see
    RunRequest's docstring for why). Reads `provider_connections`/
    `secrets_store` fresh off `request.app.state` the same way
    routers/execution.py's handlers do, rather than a snapshot."""
    mode = body.mode if body is not None else "live"
    connections = getattr(request.app.state, "provider_connections", None)
    secrets_store = getattr(request.app.state, "secrets_store", None)
    try:
        job = await run_job(db, job_id, mode=mode, connections=connections, secrets_store=secrets_store)
    except KeyError:
        raise HTTPException(404, "Job not found") from None
    return public_job(job)
