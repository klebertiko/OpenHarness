"""
Claude Code CLI spawn wrapper.

Live process spawn is gated (`LIVE_SPAWN=False`) until the sidecar has a
reviewed path for argv, cwd, and env. Mock / gated mode only records argv so
tests and dry-runs can assert what would have been launched.
"""

from __future__ import annotations

from dataclasses import dataclass, field

# Flip only behind an explicit feature flag / plan that reviews spawn policy.
LIVE_SPAWN = False


@dataclass
class SpawnResult:
    argv: list[str]
    spawned: bool
    detail: str = ""


@dataclass
class CliClaudeStub:
    """Records argv; does not start a subprocess while LIVE_SPAWN is False."""

    recorded: list[list[str]] = field(default_factory=list)

    def spawn(self, argv: list[str], *, mock: bool = True) -> SpawnResult:
        self.recorded.append(list(argv))
        if mock or not LIVE_SPAWN:
            return SpawnResult(
                argv=list(argv),
                spawned=False,
                detail="live spawn gated; argv recorded only",
            )
        # Intentionally unreachable until LIVE_SPAWN is enabled with a real
        # subprocess path (cwd, env scrub, timeout) — keep the gate hard.
        raise RuntimeError("LIVE_SPAWN is enabled but subprocess spawn is not implemented")
