"""CLI PATH probe — known names + Claude→Cursor preference order."""

from __future__ import annotations

import pytest

from runtime.cli_probe import (
    KNOWN_CLIS,
    preferred_cli,
    probe_cli,
    probe_known_clis,
)


def test_known_clis_includes_documented_binaries() -> None:
    # Documented PATH names only (see cli_probe module docstring).
    assert KNOWN_CLIS == ("claude", "agent", "cursor", "codex")


def test_probe_known_clis_maps_each_name(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "runtime.cli_probe.shutil.which",
        lambda name: f"/opt/{name}" if name in {"claude", "codex"} else None,
    )
    assert probe_known_clis() == {
        "claude": "/opt/claude",
        "agent": None,
        "cursor": None,
        "codex": "/opt/codex",
    }


def test_preferred_cli_order_claude_before_cursor(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "runtime.cli_probe.shutil.which",
        lambda name: f"/bin/{name}" if name in {"claude", "agent", "cursor"} else None,
    )
    clis = probe_known_clis()
    assert preferred_cli(clis) == "claude"


def test_preferred_cli_agent_or_cursor_maps_to_cursor() -> None:
    assert preferred_cli({"claude": None, "agent": "/a/agent", "cursor": None, "codex": None}) == "cursor"
    assert preferred_cli({"claude": None, "agent": None, "cursor": "/c/cursor", "codex": None}) == "cursor"


def test_preferred_cli_none_when_no_agent_clis() -> None:
    assert preferred_cli({"claude": None, "agent": None, "cursor": None, "codex": "/x/codex"}) is None


def test_probe_cli_passthrough(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("runtime.cli_probe.shutil.which", lambda name: f"/w/{name}")
    assert probe_cli("claude") == "/w/claude"
