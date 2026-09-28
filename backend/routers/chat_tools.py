"""Tools for a registered workspace. All routes inherit sidecar authentication."""
import asyncio
from pathlib import Path

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field, ValidationError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from database import get_db
from models import CoworkProject
from providers.resolution import ADAPTER_BY_PROVIDER
from routers.execution import _validated_project_cwd
from sandbox.capabilities import capabilities as tool_capabilities
from sandbox.discover import discover as discover_workspace
from sandbox.read import READ_MAX_BYTES, ReadFailure, read_text

router = APIRouter(prefix="/chat/tools", tags=["chat-tools"])


@router.get('/capabilities')
async def capabilities(request: Request, cwd: str | None = None, connection_id: str | None = None, db: AsyncSession = Depends(get_db)):
    root = await _validated_project_cwd(db, cwd)
    row = (getattr(request.app.state, 'provider_connections', {}) or {}).get(connection_id, {})
    provider = row.get('provider', 'mock')
    adapter = ADAPTER_BY_PROVIDER.get(provider, provider)
    project = (await db.execute(select(CoworkProject).where(CoworkProject.root_path == cwd))).scalars().first() if root else None
    return tool_capabilities(root, adapter, name=project.name if project else None,
                             unsupported=provider not in ADAPTER_BY_PROVIDER and adapter != 'mock' or not row.get('enabled', True))


@router.get('/discover')
async def discover(cwd: str | None = None, db: AsyncSession = Depends(get_db)):
    root = await _validated_project_cwd(db, cwd)
    if root is None:
        return JSONResponse({'error': 'no-workspace'}, status_code=400)
    return await asyncio.to_thread(discover_workspace, Path(root))


class ReadRequest(BaseModel):
    model_config = ConfigDict(strict=True, extra="forbid")
    cwd: str | None = None
    path: str = Field(min_length=1)
    max_bytes: int = Field(default=READ_MAX_BYTES, ge=1, le=READ_MAX_BYTES, strict=True)
    truncate: bool = True


@router.post("/read")
async def read(request: Request, db: AsyncSession = Depends(get_db)):
    raw = None
    try:
        raw = await request.json()
        body = ReadRequest.model_validate(raw)
    except (ValueError, ValidationError):
        return JSONResponse({"error": "invalid_argument", "path": raw.get("path") if isinstance(raw, dict) else None}, status_code=400)
    root = await _validated_project_cwd(db, body.cwd)
    if root is None:
        return JSONResponse({"error": "no-workspace", "path": body.path}, status_code=400)
    try:
        return await asyncio.to_thread(read_text, Path(root), body.path, body.max_bytes, body.truncate)
    except ReadFailure as exc:
        return JSONResponse({"error": exc.code, "path": body.path}, status_code=exc.status)
