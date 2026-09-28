"""
SEC P2-1 (remaining backend half) — `_node_view()` must never let a graph
node's own `data.adapter` field speak for an intrinsic node.

`input`/`output`/`router`/`hitl` are resolved entirely by the engine itself —
no adapter round-trip ever happens for them (`engine.py`'s `_INTRINSIC` set).
Before this fix, `_node_view()` did `"adapter": data.get("adapter", "mock")`
unconditionally, so a crafted/imported bundle carrying `data.adapter: "claude"`
on e.g. a HITL gate had that string echoed straight onto `node_start` (and the
`run_start.order` preview) even though the node never contacted any vendor.
The frontend's crediting path has its own independent guard now
(`useRunStream.ts` requires `provider_verified === true` + a real
`connection_id`, neither of which an intrinsic node ever emits), but the
engine must not hand out a false `adapter` string in the first place — the
event vocabulary is a public contract other consumers can read too.

These tests drive `execute_harness` directly in `mock` mode: `_node_view` is
called unconditionally for every intrinsic branch regardless of execution
mode, so no provider resolution, secrets store, or live connection is needed
to exercise the bug.
"""
from __future__ import annotations

import asyncio
import json
from typing import AsyncIterator

from engine import RunControl, execute_harness

_HOSTILE_ADAPTER = "claude"  # what a crafted bundle claims; must never survive


def _parse_chunk(chunk: str) -> tuple[str, dict]:
    name, _, rest = chunk.partition("\n")
    name = name.removeprefix("event: ").strip()
    data_line = rest.strip().removeprefix("data: ")
    return name, json.loads(data_line)


async def _collect_all(agen: AsyncIterator[str]) -> list[tuple[str, dict]]:
    events = []
    async for chunk in agen:
        events.append(_parse_chunk(chunk))
    return events


async def _collect_until(agen: AsyncIterator[str], node_id: str, event_name: str = "node_start") -> list[tuple[str, dict]]:
    """Pull events until (and including) the target event for `node_id`, then
    stop — deliberately does not drain the generator to `harness_done`. Used
    for the `hitl` case, whose node_start fires before the run parks waiting
    for an approval this test has no reason to supply; breaking out of the
    `async for` here is safe (no concurrent task is holding the generator
    open, and asyncio's shutdown_asyncgens() closes it cleanly at process
    end) — nothing here awaits or blocks on the abandoned generator."""
    events: list[tuple[str, dict]] = []
    async for chunk in agen:
        parsed = _parse_chunk(chunk)
        events.append(parsed)
        if parsed[0] == event_name and parsed[1].get("node_id") == node_id:
            break
    return events


def test_input_output_router_intrinsic_nodes_ignore_spoofed_adapter() -> None:
    """A graph where every intrinsic node claims `data.adapter: "claude"` —
    the reachable-via-imported-bundle shape SEC's report describes
    (`bundleGraph.ts` preserves `existingData.adapter` on any node type with
    no filter). None of these three ever call an adapter; all three must
    report "mock" on both `node_start` and the `run_start` preview, not the
    claimed string."""
    graph = {
        "nodes": [
            {"id": "in", "type": "input", "data": {"prompt": "hi", "adapter": _HOSTILE_ADAPTER}},
            {"id": "rt", "type": "router", "data": {"adapter": _HOSTILE_ADAPTER}},
            {"id": "out", "type": "output", "data": {"adapter": _HOSTILE_ADAPTER}},
        ],
        "edges": [
            {"source": "in", "target": "rt"},
            {"source": "rt", "target": "out"},
        ],
    }

    async def go() -> list[tuple[str, dict]]:
        control = RunControl("t")
        return await _collect_all(
            execute_harness(graph, execution_mode="mock", control=control, connections={}, secrets_store=None)
        )

    events = asyncio.run(go())

    run_start = next(d for n, d in events if n == "run_start")
    order_by_id = {entry["node_id"]: entry for entry in run_start["order"]}
    for node_id in ("in", "rt", "out"):
        assert order_by_id[node_id]["adapter"] == "mock", (
            f"run_start.order leaked spoofed adapter for intrinsic node {node_id!r}"
        )

    for node_id in ("in", "rt", "out"):
        node_start = next(d for n, d in events if n == "node_start" and d["node_id"] == node_id)
        assert node_start["adapter"] == "mock", (
            f"node_start leaked spoofed adapter for intrinsic node {node_id!r}"
        )
        assert node_start["intrinsic"] is True

    harness_done = next(d for n, d in events if n == "harness_done")
    assert harness_done["status"] == "complete"


def test_hitl_intrinsic_node_ignores_spoofed_adapter() -> None:
    """The specific reachability SEC verified: a HITL gate whose `data.adapter`
    is spoofed. A person approving the gate must not see "Verified by a real
    run" for a connection this node never touched."""
    graph = {
        "nodes": [
            {"id": "in", "type": "input", "data": {"prompt": "hi", "adapter": _HOSTILE_ADAPTER}},
            {"id": "gate", "type": "hitl", "data": {"label": "Approve", "adapter": _HOSTILE_ADAPTER}},
        ],
        "edges": [{"source": "in", "target": "gate"}],
    }

    async def go() -> list[tuple[str, dict]]:
        control = RunControl("t")
        return await _collect_until(
            execute_harness(graph, execution_mode="mock", control=control, connections={}, secrets_store=None),
            node_id="gate",
            event_name="node_start",
        )

    events = asyncio.run(go())

    node_start = next(d for n, d in events if n == "node_start" and d["node_id"] == "gate")
    assert node_start["adapter"] == "mock"
    assert node_start["intrinsic"] is True


def test_adapter_backed_node_is_unaffected_by_the_intrinsic_fix() -> None:
    """Belt-and-braces: an `llm` node (adapter-backed, not intrinsic) must
    keep working exactly as before — this fix must only ever narrow, never
    change, behaviour for non-intrinsic node types. Mock mode always uses
    MockAdapter regardless of `data.adapter`, which is the existing,
    unrelated behaviour `test_engine_provider_resolution.py` already pins;
    reconfirmed here so a future change to `_node_view` can't reintroduce
    the intrinsic bug by "fixing" this node type into the same code path."""
    graph = {
        "nodes": [
            {"id": "in", "type": "input", "data": {"prompt": "hi"}},
            {"id": "draft", "type": "llm", "data": {"label": "Draft"}},
        ],
        "edges": [{"source": "in", "target": "draft"}],
    }

    async def go() -> list[tuple[str, dict]]:
        control = RunControl("t")
        return await _collect_all(
            execute_harness(graph, execution_mode="mock", control=control, connections={}, secrets_store=None)
        )

    events = asyncio.run(go())
    node_start = next(d for n, d in events if n == "node_start" and d["node_id"] == "draft")
    assert node_start["adapter"] == "mock"
    assert node_start["intrinsic"] is False
