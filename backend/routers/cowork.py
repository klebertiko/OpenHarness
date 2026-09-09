"""Cowork projects — workspace files, instructions, memory, optional harness."""

from __future__ import annotations

import json
import uuid
from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from models import CoworkProject

router = APIRouter(prefix="/cowork", tags=["cowork"])


class ProjectCreate(BaseModel):
    name: str
    rootPath: str = ""
    instructions: str = ""
    memoryJson: dict[str, Any] = Field(default_factory=dict)
    harnessBundleId: str | None = None
    harnessEnabled: bool = True


class ProjectUpdate(BaseModel):
    name: str | None = None
    rootPath: str | None = None
    instructions: str | None = None
    memoryJson: dict[str, Any] | None = None
    harnessBundleId: str | None = None
    harnessEnabled: bool | None = None


def _public(p: CoworkProject) -> dict[str, Any]:
    try:
        memory = json.loads(p.memory_json or "{}")
    except json.JSONDecodeError:
        memory = {}
    return {
        "id": p.id,
        "name": p.name,
        "rootPath": p.root_path,
        "instructions": p.instructions,
        "memoryJson": memory,
        "harnessBundleId": p.harness_bundle_id,
        "harnessEnabled": p.harness_enabled,
    }


@router.get("/projects")
async def list_projects(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(CoworkProject).order_by(CoworkProject.updated_at.desc()))
    return {"projects": [_public(p) for p in result.scalars().all()]}


@router.post("/projects", status_code=201)
async def create_project(body: ProjectCreate, db: AsyncSession = Depends(get_db)):
    project = CoworkProject(
        id=str(uuid.uuid4()),
        name=body.name,
        root_path=body.rootPath,
        instructions=body.instructions,
        memory_json=json.dumps(body.memoryJson),
        harness_bundle_id=body.harnessBundleId,
        harness_enabled=body.harnessEnabled,
    )
    db.add(project)
    await db.commit()
    await db.refresh(project)
    return _public(project)


@router.get("/projects/{project_id}")
async def get_project(project_id: str, db: AsyncSession = Depends(get_db)):
    project = await db.get(CoworkProject, project_id)
    if not project:
        raise HTTPException(404, "Project not found")
    return _public(project)


@router.put("/projects/{project_id}")
async def update_project(
    project_id: str,
    body: ProjectUpdate,
    db: AsyncSession = Depends(get_db),
):
    project = await db.get(CoworkProject, project_id)
    if not project:
        raise HTTPException(404, "Project not found")
    if body.name is not None:
        project.name = body.name
    if body.rootPath is not None:
        project.root_path = body.rootPath
    if body.instructions is not None:
        project.instructions = body.instructions
    if body.memoryJson is not None:
        project.memory_json = json.dumps(body.memoryJson)
    if "harnessBundleId" in body.model_fields_set:
        project.harness_bundle_id = body.harnessBundleId
    if body.harnessEnabled is not None:
        project.harness_enabled = body.harnessEnabled
    project.updated_at = datetime.utcnow()
    await db.commit()
    await db.refresh(project)
    return _public(project)


@router.delete("/projects/{project_id}", status_code=204)
async def delete_project(project_id: str, db: AsyncSession = Depends(get_db)):
    project = await db.get(CoworkProject, project_id)
    if not project:
        raise HTTPException(404, "Project not found")
    await db.delete(project)
    await db.commit()
    return None
