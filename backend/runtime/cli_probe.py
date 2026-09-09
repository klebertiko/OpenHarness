"""PATH probes for official agent CLIs (Claude Code, Codex, …)."""

from __future__ import annotations

import shutil

KNOWN_CLIS: tuple[str, ...] = ("claude", "codex")


def probe_cli(name: str) -> str | None:
    """Return absolute path if `name` is on PATH, else None (`which`-style)."""
    return shutil.which(name)


def probe_known_clis() -> dict[str, str | None]:
    return {name: probe_cli(name) for name in KNOWN_CLIS}
