"""Resolve an existing tool target inside a server-authorized workspace root."""
import os
from pathlib import Path, PureWindowsPath


class PathViolation(ValueError):
    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


def resolve_in_root(root: Path, requested: str) -> Path:
    base = root.resolve()
    windows = PureWindowsPath(requested)
    if (requested.replace("\\", "/").startswith("//")
            or (windows.drive and not windows.is_absolute())
            or any(":" in part for part in windows.parts[1:] if windows.drive)
            or (not windows.drive and ":" in requested)
            or windows.is_reserved()):
        raise PathViolation("path_escapes_root")
    candidate = base / requested
    lexical = Path(os.path.abspath(candidate))
    if not lexical.is_relative_to(base):
        raise PathViolation("path_escapes_root")
    try:
        resolved = candidate.resolve(strict=True)
    except (OSError, RuntimeError, ValueError) as exc:
        raise PathViolation("not_found") from exc
    if not resolved.is_relative_to(base):
        raise PathViolation("symlink_escapes_root")
    return resolved
