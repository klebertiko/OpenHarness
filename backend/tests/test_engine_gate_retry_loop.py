"""execute_harness() must treat a Gate's `fail` port looping back to an
earlier node as a bounded retry/rework loop, not a structural graph error.

Reproduces the Studio canvas "4 errors" false positive (screenshot,
2026-09-17 04:34): Skill -> Agent -> Gate -> HITL, with the Gate's `fail`
output wired back to Agent. `topological_sort` (Kahn's algorithm,
backend/engine.py) used to have zero awareness of edge/port identity
(`sourceHandle`) -- it saw Agent<->Gate as a plain structural cycle, so
Kahn's algorithm never zeroed Agent's in-degree and Agent/Gate/HITL all ended
up `unreachable`, forcing `status: "error"` even though nothing was actually
wrong: this is a deliberate, named retry shape (a Gate's `fail` port is
*meant* to loop back), not an accidental cycle.

These tests swap the screenshot's terminal HITL node for a plain `output`
node: HITL's `park()` blocks on an external `/execute/{run_id}/control`
resolve that a direct `execute_harness()` driver never sends, which would
hang every test here on an unrelated concern. The cycle/retry mechanics
under test (topological_sort's retry-edge classification, the Gate
pass/fail decision, and the bounded rewind loop) are identical either way --
nothing downstream of Gate's `pass` port participates in any of it.

Contrast with backend/tests/test_engine_cycle_handling.py: a plain cycle
between two ordinary nodes (no Gate, or a Gate edge not on its `fail` port)
must still be a hard, immediate error -- this leniency is specific to the
Gate-fail-retry shape only, and that file's two existing tests are the
regression guard for that.
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


def _gate_loop_graph(*, gate_data: dict | None = None) -> dict:
    # Skill -> Agent -> Gate -[pass]-> Output
    #             ^-------------[fail]-'
    return {
        "nodes": [
            {"id": "skill", "type": "skill", "data": {"label": "Skill"}},
            {"id": "agent", "type": "agent", "data": {"label": "Agent"}},
            {"id": "gate", "type": "gate", "data": {"label": "Gate", **(gate_data or {})}},
            {"id": "out", "type": "output", "data": {"label": "Output"}},
        ],
        "edges": [
            {"id": "e1", "source": "skill", "target": "agent", "sourceHandle": "out"},
            {"id": "e2", "source": "agent", "target": "gate", "sourceHandle": "out"},
            {"id": "e3", "source": "gate", "target": "out", "sourceHandle": "pass"},
            {"id": "e4", "source": "gate", "target": "agent", "sourceHandle": "fail"},
        ],
    }


async def _run(graph: dict, run_id: str) -> list[str]:
    control = RunControl(run_id)
    return [
        c
        async for c in execute_harness(graph, execution_mode="mock", control=control, run_id=run_id)
    ]


def test_gate_fail_loop_does_not_mark_the_graph_unreachable() -> None:
    # Default mock outcome (no `data.mockOutcome` pinned) is "pass" -- the
    # same "runs fine" outcome as a Gate with no fail edge at all, per the
    # parallel session's sanity check that a graph with no back-edge already
    # runs fine in mock today. The point of this test is purely structural:
    # Agent/Gate/Output must not be `unreachable` just because a fail edge
    # happens to close a cycle back to Agent, and the run must complete.
    events = _events(asyncio.run(_run(_gate_loop_graph(), "gate1")))

    run_start = next(d for n, d in events if n == "run_start")
    assert run_start["unreachable"] == []

    harness_done = next(d for n, d in events if n == "harness_done")
    assert harness_done["status"] == STATUS_COMPLETE
    # Skill, Agent, Gate, Output each ran exactly once on the default pass path.
    assert harness_done["nodes_run"] == 4
    assert not [n for n, _ in events if n == "gate_retry"]


def test_gate_fail_loop_actually_retries_and_can_recover_within_the_cap() -> None:
    # A real bounded loop, not just "doesn't error": the Gate fails its
    # first two attempts and passes on the third, well inside the default
    # cap of 3. Agent and Gate must each genuinely run three times -- this
    # is what distinguishes an actual rework loop from merely suppressing
    # the false error.
    graph = _gate_loop_graph(gate_data={"mockOutcome": ["fail", "fail", "pass"]})
    events = _events(asyncio.run(_run(graph, "gate2")))

    retries = [d for n, d in events if n == "gate_retry"]
    assert [r["attempt"] for r in retries] == [1, 2]
    assert all(r["target"] == "agent" for r in retries)

    node_starts = [d["node_id"] for n, d in events if n == "node_start"]
    assert node_starts.count("agent") == 3
    assert node_starts.count("gate") == 3

    harness_done = next(d for n, d in events if n == "harness_done")
    assert harness_done["status"] == STATUS_COMPLETE
    assert harness_done["nodes_run"] == 1 + 3 + 3 + 1  # skill + agent*3 + gate*3 + out


def test_gate_fail_loop_exhausting_the_cap_is_a_real_error() -> None:
    # A Gate that never passes must not retry forever, and must not be
    # silently waved through either -- exhausting the cap is a genuine
    # runtime failure, reported the same way every other hard-stop in this
    # function is (status: error, a node_error explaining why, no further
    # nodes run).
    graph = _gate_loop_graph(gate_data={"mockOutcome": "fail", "maxIterations": 1})
    events = _events(asyncio.run(_run(graph, "gate3")))

    retries = [d for n, d in events if n == "gate_retry"]
    assert [r["attempt"] for r in retries] == [1]

    node_errors = [d for n, d in events if n == "node_error"]
    assert len(node_errors) == 1
    assert node_errors[0]["node_id"] == "gate"
    assert "did not pass" in node_errors[0]["error"]

    harness_done = next(d for n, d in events if n == "harness_done")
    assert harness_done["status"] == STATUS_ERROR
    # "out" never runs -- the pass branch was never taken.
    node_starts = [d["node_id"] for n, d in events if n == "node_start"]
    assert "out" not in node_starts


def test_a_plain_two_node_cycle_with_no_gate_is_still_a_hard_error() -> None:
    # Regression anchor duplicated from test_engine_cycle_handling.py's own
    # test, kept here too so this file alone proves the Gate-retry leniency
    # did not swallow the general case: an ordinary cycle with no Gate
    # involved at all must still error immediately.
    graph = {
        "nodes": [{"id": "a", "type": "agent", "data": {"label": "A"}}, {"id": "b", "type": "agent", "data": {"label": "B"}}],
        "edges": [{"source": "a", "target": "b"}, {"source": "b", "target": "a"}],
    }

    events = _events(asyncio.run(_run(graph, "cyc-noguard")))

    run_start = next(d for n, d in events if n == "run_start")
    assert run_start["unreachable"] == ["a", "b"]

    harness_done = next(d for n, d in events if n == "harness_done")
    assert harness_done["status"] == STATUS_ERROR
    assert harness_done["nodes_run"] == 0


def test_gate_fail_edge_that_does_not_close_a_cycle_behaves_as_a_normal_edge() -> None:
    # A Gate's `fail` port pointed at a distinct terminal node (not an
    # ancestor of the Gate) isn't a loop at all -- topological_sort must
    # leave it as an ordinary structural edge, not misclassify it as retry.
    graph = {
        "nodes": [
            {"id": "agent", "type": "agent", "data": {"label": "Agent"}},
            {"id": "gate", "type": "gate", "data": {"label": "Gate"}},
            {"id": "out", "type": "output", "data": {"label": "Output"}},
            {"id": "err", "type": "output", "data": {"label": "Error branch"}},
        ],
        "edges": [
            {"source": "agent", "target": "gate", "sourceHandle": "out"},
            {"source": "gate", "target": "out", "sourceHandle": "pass"},
            {"source": "gate", "target": "err", "sourceHandle": "fail"},
        ],
    }

    events = _events(asyncio.run(_run(graph, "gate-no-loop")))

    run_start = next(d for n, d in events if n == "run_start")
    assert run_start["unreachable"] == []
    assert not [n for n, _ in events if n == "gate_retry"]

    harness_done = next(d for n, d in events if n == "harness_done")
    assert harness_done["status"] == STATUS_COMPLETE
