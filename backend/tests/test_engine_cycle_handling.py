"""execute_harness() must report an invalid graph as an error, not success.

Independently verified (2026-09-12) against a research handoff's claim: a
cycle produced `unreachable=['a','b']`, `order=[]`, `nodes_run=0`, and
`status='complete'` — zero nodes ran and the terminal state still said
success. `run_start`'s `notices` already explained *why* (nodes unreachable,
check for a cycle); this is what makes the *outcome* honest too.
"""

from __future__ import annotations

import asyncio
import json

from engine import STATUS_COMPLETE, STATUS_ERROR, RunControl, execute_harness


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


def test_a_two_node_cycle_reports_error_not_complete() -> None:
    graph = {
        "nodes": [{"id": "a", "type": "agent", "data": {"label": "A"}}, {"id": "b", "type": "agent", "data": {"label": "B"}}],
        "edges": [{"source": "a", "target": "b"}, {"source": "b", "target": "a"}],
    }

    async def run() -> list[str]:
        control = RunControl("cyc1")
        return [c async for c in execute_harness(graph, execution_mode="mock", control=control, run_id="cyc1")]

    events = _events(asyncio.run(run()))
    run_start = next(d for n, d in events if n == "run_start")
    assert run_start["unreachable"] == ["a", "b"]
    assert run_start["order"] == []

    harness_done = next(d for n, d in events if n == "harness_done")
    assert harness_done["status"] == STATUS_ERROR
    assert harness_done["nodes_run"] == 0


def test_a_partial_cycle_still_reports_error_even_though_some_nodes_ran() -> None:
    # entry -> reachable (runs fine); x <-> y is an unrelated cycle elsewhere
    # in the same graph. The graph is still structurally invalid — a person
    # authoring it needs to know, even though *something* executed.
    graph = {
        "nodes": [
            {"id": "entry", "type": "input", "data": {"prompt": "hi"}},
            {"id": "reachable", "type": "output", "data": {"label": "out"}},
            {"id": "x", "type": "agent", "data": {"label": "X"}},
            {"id": "y", "type": "agent", "data": {"label": "Y"}},
        ],
        "edges": [
            {"source": "entry", "target": "reachable"},
            {"source": "x", "target": "y"},
            {"source": "y", "target": "x"},
        ],
    }

    async def run() -> list[str]:
        control = RunControl("cyc2")
        return [c async for c in execute_harness(graph, execution_mode="mock", control=control, run_id="cyc2")]

    events = _events(asyncio.run(run()))
    run_start = next(d for n, d in events if n == "run_start")
    assert set(run_start["unreachable"]) == {"x", "y"}

    harness_done = next(d for n, d in events if n == "harness_done")
    assert harness_done["status"] == STATUS_ERROR
    assert harness_done["nodes_run"] == 2  # entry + reachable ran; x/y did not


def test_an_acyclic_graph_still_reports_complete() -> None:
    # Regression guard for the fix itself: a normal graph with nothing
    # unreachable must not become collateral damage.
    graph = {
        "nodes": [
            {"id": "entry", "type": "input", "data": {"prompt": "hi"}},
            {"id": "out", "type": "output", "data": {"label": "out"}},
        ],
        "edges": [{"source": "entry", "target": "out"}],
    }

    async def run() -> list[str]:
        control = RunControl("ok1")
        return [c async for c in execute_harness(graph, execution_mode="mock", control=control, run_id="ok1")]

    events = _events(asyncio.run(run()))
    harness_done = next(d for n, d in events if n == "harness_done")
    assert harness_done["status"] == STATUS_COMPLETE
