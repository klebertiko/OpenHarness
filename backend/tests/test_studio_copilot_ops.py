"""validate_ops against the 32 frozen golden cases (spec §4.3)."""
from __future__ import annotations

import copy
import json
from pathlib import Path

import pytest

from studio_copilot import catalog, ops

EXAMPLES = json.loads((Path(catalog.__file__).resolve().parent / "contract_examples.json").read_text(encoding="utf-8"))
BASE = EXAMPLES["baseGraph"]
CASES = EXAMPLES["cases"]


@pytest.mark.parametrize("case", CASES, ids=[c["name"] for c in CASES])
def test_golden_case(case):
    result = ops.validate_ops(BASE, case["ops"])
    expect = case["expect"]
    if expect["ok"]:
        assert result["ok"] is True, result
        assert len(result["graph"]["nodes"]) == expect["nodes"]
        assert len(result["graph"]["edges"]) == expect["edges"]
    else:
        assert result["ok"] is False
        assert len(result["errors"]) == 1
        assert result["errors"][0]["index"] == expect["index"]
        assert result["errors"][0]["code"] == expect["code"]
        assert result["errors"][0]["message"]


def test_all_golden_error_codes_are_exported():
    codes = {c["expect"]["code"] for c in CASES if not c["expect"]["ok"]}
    assert codes <= set(ops.ERROR_CODES)
    assert len(ops.ERROR_CODES) == 14


@pytest.mark.parametrize("case", CASES, ids=[c["name"] for c in CASES])
def test_validate_never_mutates_its_inputs(case):
    graph, case_ops = copy.deepcopy(BASE), copy.deepcopy(case["ops"])
    ops.validate_ops(graph, case_ops)
    assert graph == BASE
    assert case_ops == case["ops"]


def test_graph_limit_on_the_second_add_node():
    graph = {
        "nodes": [{"id": f"a{i}", "type": "agent", "label": f"A{i}", "config": {}} for i in range(59)],
        "edges": [],
    }
    add = [
        {"op": "addNode", "ref": "n1", "type": "agent", "label": "One"},
        {"op": "addNode", "ref": "n2", "type": "agent", "label": "Two"},
    ]
    result = ops.validate_ops(graph, add)
    assert result["ok"] is False
    assert result["errors"][0]["index"] == 1
    assert result["errors"][0]["code"] == "graph_limit"


def test_graph_limit_on_edges():
    nodes = [{"id": f"a{i}", "type": "agent", "label": f"A{i}", "config": {}} for i in range(3)]
    nodes.append({"id": "g", "type": "gate", "label": "G", "config": {}})
    edges = [
        {"source": "a0", "sourceHandle": "out", "target": "a1", "targetHandle": "in"} for _ in range(0)
    ]
    # 120 distinct edges are impossible with 4 nodes, so use a synthetic wide graph.
    nodes = [{"id": f"n{i:03d}", "type": "agent", "label": "x", "config": {}} for i in range(16)]
    edges = [
        {"source": nodes[i]["id"], "sourceHandle": "out", "target": nodes[j]["id"], "targetHandle": "in"}
        for i in range(16)
        for j in range(16)
        if i != j
    ][:120]
    nodes.append({"id": "tail", "type": "agent", "label": "Tail", "config": {}})
    result = ops.validate_ops({"nodes": nodes, "edges": edges}, [{"op": "connect", "from": "n000", "to": "tail"}])
    assert result["ok"] is False
    assert result["errors"][0]["code"] == "graph_limit"


def test_refs_resolve_to_synthetic_ids_in_the_result():
    result = ops.validate_ops(
        BASE,
        [
            {"op": "addNode", "ref": "n1", "type": "agent", "label": "Reviewer"},
            {"op": "connect", "from": "n1", "to": "g1"},
        ],
    )
    assert result["ok"] is True
    ids = [n["id"] for n in result["graph"]["nodes"]]
    assert "ref:n1" in ids
    assert any(e["source"] == "ref:n1" and e["target"] == "g1" for e in result["graph"]["edges"])


def test_ref_colliding_with_an_existing_id_is_bad_ref():
    graph = {"nodes": [{"id": "n1", "type": "agent", "label": "Existing", "config": {}}], "edges": []}
    result = ops.validate_ops(graph, [{"op": "addNode", "ref": "n1", "type": "agent", "label": "Dup"}])
    assert result["errors"][0]["code"] == "bad_ref"


def test_decision_nodes_exist_but_cannot_be_wired_to_or_from():
    graph = {
        "nodes": [
            {"id": "d1", "type": "decision", "label": "Branch", "config": {}},
            {"id": "a1", "type": "agent", "label": "A", "config": {}},
        ],
        "edges": [],
    }
    from_decision = ops.validate_ops(graph, [{"op": "connect", "from": "d1", "to": "a1"}])
    assert from_decision["errors"][0]["code"] == "bad_port"
    to_decision = ops.validate_ops(graph, [{"op": "connect", "from": "a1", "to": "d1"}])
    assert to_decision["errors"][0]["code"] == "no_input_port"
    assert ops.validate_ops(graph, [{"op": "removeNode", "id": "d1"}])["ok"] is True


@pytest.mark.parametrize(
    "bad_op",
    [
        {"op": "addNode", "ref": "n1", "type": "agent", "label": "X", "provider": "openai"},
        {"op": "addNode", "ref": "n1", "type": "agent"},
        {"op": "addNode", "ref": "n1", "type": "agent", "label": 3},
        {"op": "updateNode", "id": "a1", "label": "X", "config": "nope"},
        {"op": "removeNode"},
        {"op": "connect", "from": "a1", "to": ["g1"]},
        {"op": "updateNode", "id": "a1", "config": {"emits": "Reviewed"}},
        {"op": "updateNode", "id": "a1", "config": {"systemPrompt": 5}},
    ],
)
def test_wrong_shapes_are_field_invalid(bad_op):
    result = ops.validate_ops(BASE, [bad_op])
    assert result["ok"] is False
    assert result["errors"][0]["code"] == "field_invalid"


def test_non_object_op_is_unknown_op():
    assert ops.validate_ops(BASE, ["addNode"])["errors"][0]["code"] == "unknown_op"


@pytest.mark.parametrize(
    "key", ["secretRef", "apiKey", "endpoint", "mcpCommand", "mcpUrl", "providerIds", "adapter", "model", "cwd", "toolKind"]
)
def test_credential_provider_and_exec_keys_are_never_editable(key):
    for node_id in ("a1", "g1", "h1", "s1"):
        result = ops.validate_ops(BASE, [{"op": "updateNode", "id": node_id, "config": {key: "x"}}])
        assert result["errors"][0]["code"] == "field_not_editable", (node_id, key)


def test_a_failed_op_applies_nothing():
    result = ops.validate_ops(
        BASE,
        [
            {"op": "removeNode", "id": "a1"},
            {"op": "connect", "from": "a1", "to": "g1"},
        ],
    )
    assert result["ok"] is False
    assert "graph" not in result


# ── QA wave 1 regressions ──────────────────────────────────────────────────

def test_synthetic_ref_ids_are_internal_and_cannot_be_used_as_targets():
    base = [{"op": "addNode", "ref": "n2", "type": "gate", "label": "G"}]
    for follow in (
        {"op": "removeNode", "id": "ref:n2"},
        {"op": "updateNode", "id": "ref:n2", "label": "X"},
        {"op": "connect", "from": "ref:n2", "to": "g1"},
        {"op": "addNode", "ref": "n3", "type": "agent", "label": "A", "near": "ref:n2"},
    ):
        result = ops.validate_ops(BASE, base + [follow])
        assert result["errors"][0] == {"index": 1, "code": "unknown_node", "message": result["errors"][0]["message"]}, follow


def test_a_base_node_named_like_a_synthetic_ref_blocks_that_ref():
    graph = {"nodes": [{"id": "ref:n1", "type": "agent", "label": "Odd", "config": {}}], "edges": []}
    result = ops.validate_ops(graph, [{"op": "addNode", "ref": "n1", "type": "agent", "label": "X"}])
    assert result["errors"][0]["code"] == "bad_ref"


@pytest.mark.parametrize("op_value", [["addNode"], {}, {"a": 1}, 7, None, True])
def test_a_non_string_op_field_is_unknown_op_and_never_crashes(op_value):
    result = ops.validate_ops(BASE, [{"op": op_value}])
    assert result["ok"] is False
    assert result["errors"][0]["code"] == "unknown_op"


@pytest.mark.parametrize(
    "label, ok",
    [
        ("\x1c", True),  # not whitespace to JavaScript's trim, so the twin accepts it
        ("\x85", True),
        ("﻿", False),  # JavaScript trims the BOM; Python's strip() does not
        (" ", False),
        ("　x　", True),
    ],
)
def test_label_trimming_matches_javascript_trim(label, ok):
    result = ops.validate_ops(BASE, [{"op": "updateNode", "id": "s1", "label": label}])
    assert result["ok"] is ok
    if ok:
        node = next(n for n in result["graph"]["nodes"] if n["id"] == "s1")
        assert node["label"] == label.strip("\t\n\x0b\x0c\r                  　﻿")
