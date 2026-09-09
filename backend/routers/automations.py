"""Automations / Schedules — on-demand and cron jobs with optional harness."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from automations.scheduler import run_job
from database import get_db
from models import AutomationJob

router = APIRouter(prefix="/automations", tags=["automations"])


class JobCreate(BaseModel):
    name: str
    cron: str | None = None
    projectId: str | None = None
    harnessBundleId: str | None = None
    harnessEnabled: bool = False


class JobUpdate(BaseModel):
    name: str | None = None
    cron: str | None = None
    projectId: str | None = None
    harnessBundleId: str | None = None
    harnessEnabled: bool | None = None


def public_job(job: AutomationJob, *, result: dict[str, Any] | None = None) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "id": job.id,
        "name": job.name,
        "cron": job.cron,
        "projectId": job.project_id,
        "harnessBundleId": job.harness_bundle_id,
        "harnessEnabled": job.harness_enabled,
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
    job.updated_at = datetime.utcnow()
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
async def run_now(job_id: str, db: AsyncSession = Depends(get_db)):
    """Immediate mock execute — always available, independent of cron."""
    try:
        job = await run_job(db, job_id)
    except KeyError:
        raise HTTPException(404, "Job not found") from None
    return public_job(job)
