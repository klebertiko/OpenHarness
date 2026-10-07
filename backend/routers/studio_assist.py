"""POST /studio/assist/field — draft / improve / review one Inspector field (spec §5.1).

Offline (`mode: "mock"`) is served by `field_assist`; live/local arrive with S6.
"""
from __future__ import annotations

import json

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from pydantic import ValidationError

from studio_copilot import catalog
from studio_copilot.api_models import MAX_BODY_BYTES
from studio_copilot.field_assist import AssistRequest, assist_offline

router = APIRouter(prefix="/studio/assist", tags=["studio-assist"])


def _error(status: int, code: str, detail: str | None = None) -> JSONResponse:
    body = {"error": code}
    if detail:
        body["detail"] = detail
    return JSONResponse(body, status_code=status)


@router.post("/field")
async def assist_field(request: Request):
    try:
        declared = int(request.headers.get("content-length", 0))
    except ValueError:
        declared = 0
    if declared > MAX_BODY_BYTES:
        return _error(413, "payload_too_large")
    raw = await request.body()
    if len(raw) > MAX_BODY_BYTES:
        return _error(413, "payload_too_large")
    try:
        payload = json.loads(raw)
    except ValueError:
        return _error(400, "invalid_argument", "Body must be JSON.")
    if not isinstance(payload, dict):
        return _error(400, "invalid_argument", "Body must be a JSON object.")
    try:
        req = AssistRequest.model_validate(payload)
    except ValidationError:
        return _error(400, "invalid_argument")

    if req.field not in catalog.assistable_fields(req.node.type):
        return _error(400, "field_not_assistable", f"{req.node.type} has no assistable {req.field}.")
    if req.action == "draft" and not req.intent.strip():
        return _error(400, "invalid_argument", "Say what it should do.")

    if req.mode != "mock":
        return _error(501, "live_not_ready")
    return {**assist_offline(req), "source": "offline", "tokens": 0}
