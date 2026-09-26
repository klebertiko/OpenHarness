"""Bounded text reads; never expose secret-pattern files through the read endpoint."""
from pathlib import Path

from .paths import PathViolation, resolve_in_root
from .secrets import redact, requires_approval

READ_MAX_BYTES = 262144


class ReadFailure(ValueError):
    def __init__(self, code: str, status: int):
        super().__init__(code)
        self.code, self.status = code, status


def read_text(root: Path, requested: str, max_bytes: int = READ_MAX_BYTES, truncate: bool = True, *, approved: bool = False) -> dict:
    try:
        target = resolve_in_root(root, requested)
    except PathViolation as exc:
        raise ReadFailure(exc.code, 404 if exc.code == "not_found" else 403) from exc
    if not approved and (requires_approval(target) or requires_approval(root / requested)):
        raise ReadFailure("secret_pattern_requires_approval", 403)
    if not target.is_file():
        raise ReadFailure("binary", 415)
    try:
        with target.open("rb") as file:
            data = file.read(max(max_bytes, 8192) + 1)
    except OSError as exc:
        raise ReadFailure("not_found", 404) from exc
    if b"\x00" in data[:8192]:
        raise ReadFailure("binary", 415)
    truncated = len(data) > max_bytes
    if truncated and not truncate:
        raise ReadFailure("too_large", 413)
    data = data[:max_bytes]
    content, count = redact(data.decode("utf-8", errors="replace"))
    return {"path": target.relative_to(root.resolve()).as_posix(), "bytes": len(data),
            "truncated": truncated, "encoding": "utf-8", "content": content, "redactions": count}
