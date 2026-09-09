import json
import uuid
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from database import get_db
from models import Harness

router = APIRouter(prefix="/harnesses", tags=["harnesses"])


class HarnessCreate(BaseModel):
    name: str
    description: str = ""
    graph_json: dict


class HarnessUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    graph_json: dict | None = None


@router.get("/")
async def list_harnesses(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Harness).order_by(Harness.updated_at.desc()))
    items = result.scalars().all()
    return [
        {
            "id": h.id,
            "name": h.name,
            "description": h.description,
            "created_at": h.created_at.isoformat() if h.created_at else None,
            "updated_at": h.updated_at.isoformat() if h.updated_at else None,
        }
        for h in items
    ]


@router.post("/", status_code=201)
async def create_harness(body: HarnessCreate, db: AsyncSession = Depends(get_db)):
    harness = Harness(
        id=str(uuid.uuid4()),
        name=body.name,
        description=body.description,
        graph_json=json.dumps(body.graph_json),
    )
    db.add(harness)
    await db.commit()
    await db.refresh(harness)
    return {"id": harness.id, "name": harness.name}


@router.get("/{harness_id}")
async def get_harness(harness_id: str, db: AsyncSession = Depends(get_db)):
    h = await db.get(Harness, harness_id)
    if not h:
        raise HTTPException(404, "Harness not found")
    return {
        "id": h.id,
        "name": h.name,
        "description": h.description,
        "graph_json": json.loads(h.graph_json),
        "created_at": h.created_at.isoformat() if h.created_at else None,
        "updated_at": h.updated_at.isoformat() if h.updated_at else None,
    }


@router.put("/{harness_id}")
async def update_harness(harness_id: str, body: HarnessUpdate, db: AsyncSession = Depends(get_db)):
    h = await db.get(Harness, harness_id)
    if not h:
        raise HTTPException(404, "Harness not found")
    if body.name is not None:
        h.name = body.name
    if body.description is not None:
        h.description = body.description
    if body.graph_json is not None:
        h.graph_json = json.dumps(body.graph_json)
    h.updated_at = datetime.utcnow()
    await db.commit()
    return {"id": h.id, "name": h.name}


@router.delete("/{harness_id}", status_code=204)
async def delete_harness(harness_id: str, db: AsyncSession = Depends(get_db)):
    h = await db.get(Harness, harness_id)
    if not h:
        raise HTTPException(404, "Harness not found")
    await db.delete(h)
    await db.commit()
