"""Bundled examples must open tidy: every node placed, no two plates overlapping.

The Studio only auto-places nodes that have no ``position`` (a coarse grid that
ignores both plate width and edges), so an example that ships without
positions opens as a pile. Positions are authored by the Studio's own layered
auto-layout (frontend ``layoutGraph``) and committed with the fixture.
"""

from __future__ import annotations

import pytest

from oharness import codec, examples

# Plate geometry of a Studio node (frontend/src/components/canvas/nodes/BaseNode.tsx
# PLATE_W = 212). The height is a deliberately generous upper bound for the
# tallest plate (header + spec + note + a two-row port ledger), so a layout
# that passes here cannot overlap on screen.
PLATE_W = 212
PLATE_H = 120

FIXTURE_IDS = [e.id for e in examples.list_examples()]


def _nodes(example_id: str) -> list[dict]:
    entry = next(e for e in examples.list_examples() if e.id == example_id)
    return codec.load_path(entry.path)["graph"]["nodes"]


@pytest.mark.parametrize("example_id", FIXTURE_IDS)
def test_every_example_node_has_a_position(example_id):
    missing = [n["id"] for n in _nodes(example_id) if not isinstance(n.get("position"), dict)]
    assert missing == [], f"{example_id}: nodes without a stored position: {missing}"


@pytest.mark.parametrize("example_id", FIXTURE_IDS)
def test_example_nodes_do_not_overlap(example_id):
    boxes = [
        (n["id"], n["position"]["x"], n["position"]["y"])
        for n in _nodes(example_id)
        if isinstance(n.get("position"), dict)
    ]
    hits = [
        f"{a[0]} ~ {b[0]}"
        for i, a in enumerate(boxes)
        for b in boxes[i + 1:]
        if a[1] < b[1] + PLATE_W and b[1] < a[1] + PLATE_W
        and a[2] < b[2] + PLATE_H and b[2] < a[2] + PLATE_H
    ]
    assert hits == [], f"{example_id}: overlapping plates: {hits}"


@pytest.mark.parametrize("example_id", FIXTURE_IDS)
def test_example_layers_flow_left_to_right(example_id):
    """Every edge between two placed nodes ends to the right of where it starts."""
    entry = next(e for e in examples.list_examples() if e.id == example_id)
    graph = codec.load_path(entry.path)["graph"]
    pos = {n["id"]: n["position"] for n in graph["nodes"] if isinstance(n.get("position"), dict)}
    backwards = [
        f'{e["source"]} -> {e["target"]}'
        for e in graph["edges"]
        if e["source"] in pos and e["target"] in pos
        and e["source"] != e["target"]
        and pos[e["source"]]["x"] > pos[e["target"]]["x"]
    ]
    # A feedback edge (retry loop) legitimately points back; the bulk must not.
    assert len(backwards) <= max(1, len(graph["edges"]) // 10), backwards
