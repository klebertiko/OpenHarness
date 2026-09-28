"""Conditional routing (`edge.data.condition`) — PASS/FAIL/accept/reject
branches. Reproduced live and confirmed by an independent research pass,
2026-09-12: the engine ran every downstream node regardless of any edge
condition, so an accept/reject fork always walked both branches."""

from __future__ import annotations

import asyncio
import json

import pytest

from adapters.base import AdapterConfig, AdapterResult, AgentAdapter
from engine import STATUS_COMPLETE, RunControl, execute_harness
from secret_store.memory import MemorySecrets


class _ScriptedAdapter(AgentAdapter):
    """Returns a fixed output per node_id, via config.extra['label'] (engine
    always sets this to the node's label — see engine.py's AdapterConfig
    construction in the adapter-backed-node branch)."""

    def __init__(self, outputs_by_label: dict[str, str]) -> None:
        self._outputs = outputs_by_label

    async def invoke(self, prompt: str, config: AdapterConfig) -> AdapterResult:
        label = config.extra.get("label", "")
        return AdapterResult(content=self._outputs.get(label, "no script"))

    async def stream(self, prompt: str, config: AdapterConfig):
        yield self._outputs.get(config.extra.get("label", ""), "no script")


def _connections() -> dict[str, dict]:
    return {
        "anthropic": {
            "id": "anthropic",
            "provider": "anthropic",
            "label": "Anthropic",
            "residence": "cloud",
            "endpoint": "https://api.anthropic.com",
            "enabled": True,
            "secretRef": None,
        }
    }


def _events(chunks: list[str]) -> list[tuple[str, dict]]:
    out = []
    for c in chunks:
        if not c.startswith("event: "):
            continue
        name, _, rest = c.partition("\n")
        name = name.removeprefix("event: ").strip()
        data_line = rest.strip().removeprefix("data: ")
        out.append((name, json.loads(data_line)))
    return out


def _gate_graph() -> dict:
    return {
        "nodes": [
            {"id": "gate", "type": "agent", "data": {"label": "Gate", "providerIds": ["anthropic"], "prompt": "check"}},
            {"id": "accepted", "type": "agent", "data": {"label": "Accepted", "providerIds": ["anthropic"]}},
            {"id": "rejected", "type": "agent", "data": {"label": "Rejected", "providerIds": ["anthropic"]}},
        ],
        "edges": [
            {"source": "gate", "target": "accepted", "data": {"condition": "accept"}},
            {"source": "gate", "target": "rejected", "data": {"condition": "reject"}},
        ],
    }


def _run(graph: dict, outputs_by_label: dict[str, str], monkeypatch: pytest.MonkeyPatch) -> list[tuple[str, dict]]:
    monkeypatch.setattr("providers.resolution.get_adapter", lambda name: _ScriptedAdapter(outputs_by_label))

    async def go() -> list[str]:
        control = RunControl("t1")
        return [
            c
            async for c in execute_harness(
                graph,
                execution_mode="live",
                control=control,
                run_id="t1",
                connections=_connections(),
                secrets_store=MemorySecrets(),
            )
        ]

    return _events(asyncio.run(go()))


def test_only_the_matching_branch_runs(monkeypatch: pytest.MonkeyPatch) -> None:
    events = _run(_gate_graph(), {"Gate": "Verdict: ACCEPT — looks good."}, monkeypatch)

    node_dones = {d["node_id"] for n, d in events if n == "node_done"}
    assert node_dones == {"gate", "accepted"}

    skipped = {d["node_id"] for n, d in events if n == "node_skipped"}
    assert skipped == {"rejected"}

    harness_done = next(d for n, d in events if n == "harness_done")
    assert harness_done["status"] == STATUS_COMPLETE
    assert harness_done["nodes_run"] == 2


def test_the_other_branch_runs_when_the_output_says_so(monkeypatch: pytest.MonkeyPatch) -> None:
    events = _run(_gate_graph(), {"Gate": "This does not meet the bar — REJECT."}, monkeypatch)

    node_dones = {d["node_id"] for n, d in events if n == "node_done"}
    assert node_dones == {"gate", "rejected"}
    skipped = {d["node_id"] for n, d in events if n == "node_skipped"}
    assert skipped == {"accepted"}


def test_matching_is_case_insensitive_and_by_substring(monkeypatch: pytest.MonkeyPatch) -> None:
    # A real model rarely answers with the bare condition word alone.
    events = _run(_gate_graph(), {"Gate": "accept, with minor notes."}, monkeypatch)
    node_dones = {d["node_id"] for n, d in events if n == "node_done"}
    assert "accepted" in node_dones
    assert "rejected" not in node_dones


def test_an_unconditional_edge_always_runs_alongside_a_conditional_fork(monkeypatch: pytest.MonkeyPatch) -> None:
    graph = _gate_graph()
    graph["nodes"].append({"id": "always", "type": "agent", "data": {"label": "Always", "providerIds": ["anthropic"]}})
    graph["edges"].append({"source": "gate", "target": "always"})  # no condition

    events = _run(graph, {"Gate": "ACCEPT"}, monkeypatch)
    node_dones = {d["node_id"] for n, d in events if n == "node_done"}
    assert node_dones == {"gate", "accepted", "always"}


def test_a_downstream_node_is_skipped_when_its_only_live_path_is_dead(monkeypatch: pytest.MonkeyPatch) -> None:
    # next has one incoming conditional edge, off a source that itself ran
    # for real but answered with a condition that doesn't satisfy it — next
    # must not run just because its source did.
    graph = {
        "nodes": [
            {"id": "gate", "type": "agent", "data": {"label": "Gate", "providerIds": ["anthropic"]}},
            {"id": "accepted", "type": "agent", "data": {"label": "Accepted", "providerIds": ["anthropic"]}},
            {"id": "next", "type": "agent", "data": {"label": "Next", "providerIds": ["anthropic"]}},
        ],
        "edges": [
            {"source": "gate", "target": "accepted", "data": {"condition": "accept"}},
            {"source": "accepted", "target": "next", "data": {"condition": "ready"}},
        ],
    }
    events = _run(graph, {"Gate": "ACCEPT", "Accepted": "blocked on external review"}, monkeypatch)
    node_dones = {d["node_id"] for n, d in events if n == "node_done"}
    assert node_dones == {"gate", "accepted"}
    skipped = {d["node_id"] for n, d in events if n == "node_skipped"}
    assert skipped == {"next"}


def test_condition_matching_is_naive_substring_not_negation_aware(monkeypatch: pytest.MonkeyPatch) -> None:
    # Documents a real, deliberate limitation rather than hiding it: "ready"
    # is a substring of "not ready yet", so this *does* match today. Picking
    # distinct condition keywords (accept/reject, pass/fail) rather than a
    # word and its own negation is on the harness author, the same way a
    # routing sentinel elsewhere in this codebase had to be a token no real
    # answer would produce rather than a prefix a real answer could open
    # with (see triage.py's _ENGAGE_HARNESS_TOKEN and its own gauntlet-loop
    # critic finding, 2026-09-11).
    graph = {
        "nodes": [
            {"id": "gate", "type": "agent", "data": {"label": "Gate", "providerIds": ["anthropic"]}},
            {"id": "next", "type": "agent", "data": {"label": "Next", "providerIds": ["anthropic"]}},
        ],
        "edges": [{"source": "gate", "target": "next", "data": {"condition": "ready"}}],
    }
    events = _run(graph, {"Gate": "not ready yet"}, monkeypatch)
    node_dones = {d["node_id"] for n, d in events if n == "node_done"}
    assert "next" in node_dones  # known false positive, asserted on purpose
