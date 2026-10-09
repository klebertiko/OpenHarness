"""Shared request plumbing for the Studio routers: a capped, defensive JSON body reader."""
from __future__ import annotations

import json
from typing import Any

from fastapi import Request
from fastapi.responses import JSONResponse

from .api_models import MAX_BODY_BYTES


def error(status: int, code: str, detail: str | None = None) -> JSONResponse:
    body: dict[str, Any] = {"error": code}
    if detail:
        body["detail"] = detail
    return JSONResponse(body, status_code=status)


async def read_json_object(request: Request) -> tuple[dict[str, Any] | None, JSONResponse | None]:
    """Read the body without ever buffering more than the cap, and parse it as a JSON object.

    Returns `(payload, None)` or `(None, error response)`. The cap is enforced
    while streaming, so a chunked upload with no Content-Length is cut off at
    the limit rather than read to the end first.
    """
    try:
        declared = int(request.headers.get("content-length", 0))
    except ValueError:
        declared = 0
    if declared > MAX_BODY_BYTES:
        return None, error(413, "payload_too_large")

    received = bytearray()
    async for chunk in request.stream():
        received.extend(chunk)
        if len(received) > MAX_BODY_BYTES:
            return None, error(413, "payload_too_large")

    try:
        payload = json.loads(bytes(received))
    except (ValueError, RecursionError):
        # RecursionError: a deeply nested body must be a client error, not a 500.
        return None, error(400, "invalid_argument", "Body must be JSON.")
    if not isinstance(payload, dict):
        return None, error(400, "invalid_argument", "Body must be a JSON object.")
    return payload, None
