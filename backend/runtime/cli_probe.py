"""PATH probes for official agent CLIs (Claude Code, Cursor, Codex, …)."""

from __future__ import annotations

import shutil

# "agent" and "cursor" are both real PATH names Cursor's installer can leave
# behind depending on platform/version — probe both, prefer whichever exists.
KNOWN_CLIS: tuple[str, ...] = ("claude", "agent", "cursor", "codex")


def probe_cli(name: str) -> str | None:
    """Return absolute path if `name` is on PATH, else None (`which`-style)."""
    return shutil.which(name)


def probe_known_clis() -> dict[str, str | None]:
    return {name: probe_cli(name) for name in KNOWN_CLIS}


def preferred_cli(clis: dict[str, str | None]) -> str | None:
    """Which agent-capable CLI to prefer, given a `probe_known_clis()` result.

    Claude first (native subscription CLI), then Cursor (via either PATH name
    it may be installed under). Codex is not a preference target here — it
    has its own separate routing (see adapters/cli_codex.py), this helper is
    only for the claude/cursor delegation choice.
    """
    if clis.get("claude"):
        return "claude"
    if clis.get("agent") or clis.get("cursor"):
        return "cursor"
    return None
