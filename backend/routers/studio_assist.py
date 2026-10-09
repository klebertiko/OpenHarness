"""POST /studio/assist/field — draft / improve / review one Inspector field (spec §5.1).

Offline (`mode: "mock"`) is served by `field_assist`; live/local call the chosen
connection through `llm.complete_json` and validate the reply before returning it.
"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse
from pydantic import ValidationError
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from studio_copilot import catalog, prompts
from studio_copilot.http import error, read_json_object
from studio_copilot.field_assist import AssistRequest, assist_offline
from studio_copilot.llm import StudioLlmError, complete_json

router = APIRouter(prefix="/studio/assist", tags=["studio-assist"])

ASSIST_TIMEOUT_S = 45
TEXT_LIMIT = {"systemPrompt": "systemPromptMax", "checklist": "checklistMax"}
MAX_NOTES = 5
NOTE_MAX = 200


def _assist_validator(req: AssistRequest):
    limit = catalog.limits()[TEXT_LIMIT[req.field]]

    def validate(obj: dict[str, Any]):
        text, notes = obj.get("text"), obj.get("notes", [])
        if not isinstance(notes, list) or not all(isinstance(n, str) for n in notes):
            return None, "notes must be a list of strings"
        notes = [n.strip()[:NOTE_MAX] for n in notes[:MAX_NOTES]]
        if req.action == "review":
            if text is not None:
                return None, "text must be null for a review"
            return {"text": None, "notes": notes}, None
        if not isinstance(text, str) or not text.strip():
            return None, "text must be non-empty text"
        if len(text) > limit:
            return None, f"text must be at most {limit} characters"
        return {"text": text, "notes": notes}, None

    return validate


@router.post("/field")
async def assist_field(request: Request, db: AsyncSession = Depends(get_db)):
    payload, failure = await read_json_object(request)
    if failure is not None:
        return failure
    try:
        req = AssistRequest.model_validate(payload)
    except ValidationError:
        return error(400, "invalid_argument")

    if req.field not in catalog.assistable_fields(req.node.type):
        return error(400, "field_not_assistable", f"{req.node.type} has no assistable {req.field}.")
    if req.action == "draft" and not req.intent.strip():
        return error(400, "invalid_argument", "Say what it should do.")

    if req.mode == "mock":
        return {**assist_offline(req), "source": "offline", "tokens": 0}
    try:
        value, tokens = await complete_json(
            request,
            db,
            connection_id=req.connection_id,
            system=prompts.assist_system_prompt(req.field, req.node.type, req.action),
            user=prompts.assist_user_message(req),
            validate=_assist_validator(req),
            source="studio_assist",
            timeout_s=ASSIST_TIMEOUT_S,
            invalid_code="assist_invalid",
        )
    except StudioLlmError as exc:
        return JSONResponse(exc.body, status_code=exc.status_code)
    return {**value, "source": "model", "tokens": tokens}
