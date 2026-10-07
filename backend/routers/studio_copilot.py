"""POST /studio/copilot/plan — graph-edit proposals (spec §5.1).

Offline (`mode: "mock"`) is served by the rule-based planner; live/local modes
arrive with S6. The endpoint never returns ops that fail `validate_ops`.
"""
from __future__ import annotations

import json

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from pydantic import ValidationError

from studio_copilot import mock_planner, ops
from studio_copilot.api_models import MAX_BODY_BYTES, PlanRequest

router = APIRouter(prefix="/studio/copilot", tags=["studio-copilot"])


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


@router.post("/plan")
async def plan(request: Request):
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

    if req.mode != "mock":
        return JSONResponse({"error": "live_not_ready"}, status_code=501)

    graph = req.graph.model_dump()
    offline = mock_planner.plan_offline(req.message, graph)
    checked = ops.validate_ops(graph, offline["ops"])
    if not checked["ok"]:
        # An invalid offline plan is a planner bug, never a user error.
        return JSONResponse({"error": "offline_plan_invalid", "errors": checked["errors"]}, status_code=500)
    return {"summary": offline["summary"], "ops": offline["ops"], "source": "offline", "tokens": 0}
