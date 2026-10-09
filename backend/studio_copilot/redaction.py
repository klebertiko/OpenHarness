"""Secret redaction for Studio text.

`sandbox.secrets.redact` is the shared baseline. It misses a few common
provider key shapes (`sk-ant-…`, `sk-proj-…`, Google `AIza…`) because it only
accepts alphanumerics after `sk-`, so Studio adds those here rather than
changing a module other features depend on.
"""
from __future__ import annotations

import re

from sandbox import secrets

_EXTRA = re.compile(
    "|".join(
        f"(?P<{kind}>{pattern})"
        for kind, pattern in {
            "anthropic": r"sk-ant-[A-Za-z0-9_-]{20,}",
            "openai_project": r"sk-proj-[A-Za-z0-9_-]{20,}",
            "google": r"AIza[0-9A-Za-z_-]{30,}",
        }.items()
    )
)


def redact(text: str) -> tuple[str, int]:
    """Return `(text with secrets replaced by [redacted:<kind>], number replaced)`."""
    base, first = secrets.redact(text)
    final, second = _EXTRA.subn(lambda m: f"[redacted:{m.lastgroup}]", base)
    return final, first + second
