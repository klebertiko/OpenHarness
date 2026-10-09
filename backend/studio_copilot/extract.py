"""Pull one JSON object out of a model reply (spec §5.2 step 5).

Model output is untrusted text: it may wrap the JSON in prose or a code
fence, include braces inside strings, or be adversarially long. The scan is
bounded so a hostile reply cannot burn CPU.
"""
from __future__ import annotations

import json
import re
from typing import Any

_MAX_CHARS = 100_000
_MAX_START_POINTS = 50
_FENCE = re.compile(r"```(?:json)?[ \t]*\r?\n(.*?)```", re.DOTALL | re.IGNORECASE)


def _as_dict(text: str) -> dict[str, Any] | None:
    try:
        value = json.loads(text)
    except ValueError:
        return None
    return value if isinstance(value, dict) else None


def _balanced_end(text: str, start: int) -> int | None:
    """Index one past the `}` matching the `{` at `start`, ignoring braces inside strings."""
    depth = 0
    in_string = False
    escaped = False
    for i in range(start, len(text)):
        ch = text[i]
        if in_string:
            if escaped:
                escaped = False
            elif ch == "\\":
                escaped = True
            elif ch == '"':
                in_string = False
        elif ch == '"':
            in_string = True
        elif ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                return i + 1
    return None


def extract_json(text: str) -> dict[str, Any] | None:
    """First fenced block that parses to an object, else the first balanced `{…}` that does."""
    text = text[:_MAX_CHARS]
    for block in _FENCE.findall(text):
        found = _as_dict(block.strip())
        if found is not None:
            return found

    starts = 0
    cursor = text.find("{")
    while cursor != -1 and starts < _MAX_START_POINTS:
        starts += 1
        end = _balanced_end(text, cursor)
        if end is not None:
            found = _as_dict(text[cursor:end])
            if found is not None:
                return found
        cursor = text.find("{", cursor + 1)
    return None
