"""POST /studio/copilot/plan — graph-edit proposals (spec §5.1).

Offline (`mode: "mock"`) is served by the rule-based planner; live/local modes
call the chosen connection through `llm.complete_json`. Either way the endpoint
never returns ops that fail `validate_ops`.
"""
from __future__ import annotations

import json
from typing import Any

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse
from pydantic import ValidationError
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from studio_copilot import mock_planner, ops, prompts
from studio_copilot.api_models import MAX_BODY_BYTES, PlanRequest
from studio_copilot.llm import StudioLlmError, complete_json

router = APIRouter(prefix="/studio/copilot", tags=["studio-copilot"])

PLAN_TIMEOUT_S = 90
SUMMARY_MAX = 600


def _too_large() -> JSONResponse:
    return JSONResponse({"error": "payload_too_large"}, status_code=413)


def _invalid(detail: str | None = None) -> JSONResponse:
    body = {"error": "invalid_argument"}
    if detail:
        body["detail"] = detail
    return JSONResponse(body, status_code=400)


def _is_graph_cap(err: ValidationError) -> bool:
    return any(
        e["type"] == "too_long" and tuple(e["loc"][:2]) in {("graph", "nodes"), ("graph", "edges")}
        for e in err.errors()
    )


def _plan_validator(graph: dict[str, Any]):
    """Accept `{summary, ops}` only if every op passes the same validator the client re-runs."""

    def validate(obj: dict[str, Any]):
        summary, proposed = obj.get("summary"), obj.get("ops")
        if not isinstance(summary, str) or not 1 <= len(summary.strip()) <= SUMMARY_MAX:
            return None, f"summary must be 1-{SUMMARY_MAX} characters of text"
        if not isinstance(proposed, list):
            return None, "ops must be a list"
        checked = ops.validate_ops(graph, proposed)
        if not checked["ok"]:
            first = checked["errors"][0]
            return None, f"{first['code']}: {first['message']}"
        return {"summary": summary.strip(), "ops": proposed}, None

    return validate


@router.post("/plan")
async def plan(request: Request, db: AsyncSession = Depends(get_db)):
    try:
        declared = int(request.headers.get("content-length", 0))
    except ValueError:
        declared = 0
    if declared > MAX_BODY_BYTES:
        return _too_large()
    raw = await request.body()
    if len(raw) > MAX_BODY_BYTES:
        return _too_large()
    try:
        payload = json.loads(raw)
    except ValueError:
        return _invalid("Body must be JSON.")
    if not isinstance(payload, dict):
        return _invalid("Body must be a JSON object.")
    try:
        req = PlanRequest.model_validate(payload)
    except ValidationError as err:
        return _too_large() if _is_graph_cap(err) else _invalid()

    graph = req.graph.model_dump()
    if req.mode != "mock":
        try:
            value, tokens = await complete_json(
                request,
                db,
                connection_id=req.connection_id,
                system=prompts.plan_system_prompt(),
                user=prompts.plan_user_message(req.message, [t.model_dump() for t in req.history], graph),
                validate=_plan_validator(graph),
                source="studio_copilot",
                timeout_s=PLAN_TIMEOUT_S,
                invalid_code="plan_invalid",
            )
        except StudioLlmError as exc:
            return JSONResponse(exc.body, status_code=exc.status_code)
        return {"summary": value["summary"], "ops": value["ops"], "source": "model", "tokens": tokens}

    offline = mock_planner.plan_offline(req.message, graph)
    checked = ops.validate_ops(graph, offline["ops"])
    if not checked["ok"]:
        # An invalid offline plan is a planner bug, never a user error.
        return JSONResponse({"error": "offline_plan_invalid", "errors": checked["errors"]}, status_code=500)
    return {"summary": offline["summary"], "ops": offline["ops"], "source": "offline", "tokens": 0}
