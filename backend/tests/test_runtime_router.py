"""Runtime router — prefer CLI when present; fall back to API with reason."""

from __future__ import annotations

import asyncio

import pytest

from engine import RunControl, execute_harness
from runtime.cli_probe import KNOWN_CLIS, probe_cli
from runtime.router import RuntimeChoice, select_runtime


def test_probe_cli_uses_which(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "runtime.cli_probe.shutil.which",
        lambda name: f"/fake/bin/{name}" if name == "claude" else None,
    )
    assert probe_cli("claude") == "/fake/bin/claude"
    assert probe_cli("codex") is None
    assert set(KNOWN_CLIS) >= {"claude", "codex"}


def test_select_runtime_cli_present() -> None:
    choice = select_runtime(
        {"preferred": "cli", "cli": "claude", "env": [], "secrets": []},
        user_pref=None,
        probe=lambda name: f"/opt/{name}",
    )
    assert choice == RuntimeChoice(kind="cli", name="claude", reason="")


def test_select_runtime_cli_absent_falls_back_to_api() -> None:
    choice = select_runtime(
        {"preferred": "cli", "cli": "claude", "env": [], "secrets": []},
        user_pref=None,
        probe=lambda _name: None,
    )
    assert choice.kind == "api"
    assert choice.name == "claude"
    assert choice.reason
    assert "claude" in choice.reason.lower() or "cli" in choice.reason.lower()


def test_select_runtime_user_pref_api_skips_probe() -> None:
    calls: list[str] = []

    def probe(name: str) -> str | None:
        calls.append(name)
        return f"/opt/{name}"

    choice = select_runtime(
        {"preferred": "cli", "cli": "claude", "env": [], "secrets": []},
        user_pref="api",
        probe=probe,
    )
    assert choice.kind == "api"
    assert choice.name == "claude"
    assert calls == []


def test_select_runtime_user_pref_cli_overrides_bundle_api() -> None:
    choice = select_runtime(
        {"preferred": "api", "cli": "codex", "env": [], "secrets": []},
        user_pref="cli",
        probe=lambda name: f"/usr/bin/{name}",
    )
    assert choice == RuntimeChoice(kind="cli", name="codex", reason="")


def test_execute_emits_runtime_selected() -> None:
    harness = {
        "nodes": [{"id": "in", "type": "input", "data": {"prompt": "hi"}}],
        "edges": [],
        "runtime": {"preferred": "cli", "cli": "claude", "env": [], "secrets": []},
    }

    async def collect() -> list[str]:
        chunks: list[str] = []
        control = RunControl("test-runtime")
        async for chunk in execute_harness(
            harness,
            execution_mode="mock",
            control=control,
            probe=lambda _name: None,
        ):
            chunks.append(chunk)
        return chunks

    chunks = asyncio.run(collect())
    events = [
        c.split("\n", 1)[0].removeprefix("event: ").strip()
        for c in chunks
        if c.startswith("event: ")
    ]
    assert "runtime_selected" in events
    assert events.index("run_start") < events.index("runtime_selected")
    runtime_chunk = next(c for c in chunks if c.startswith("event: runtime_selected"))
    assert '"kind": "api"' in runtime_chunk
    assert "reason" in runtime_chunk
