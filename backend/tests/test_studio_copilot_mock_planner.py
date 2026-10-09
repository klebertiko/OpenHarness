"""Offline rule-based planner (spec §5.4, plan S1)."""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from studio_copilot import catalog, mock_planner, ops

EXAMPLES = json.loads((Path(catalog.__file__).resolve().parent / "contract_examples.json").read_text(encoding="utf-8"))
BASE = EXAMPLES["baseGraph"]
EMPTY = {"nodes": [], "edges": []}

PROMPTS = [
    "Add a review step before approval",
    "Research → write → review flow",
    "Add a security gate after QA",
    "Research → write → review flow, with human approval at the end",
]


def _added(plan):
    return [o for o in plan["ops"] if o["op"] == "addNode"]


@pytest.mark.parametrize("graph", [EMPTY, BASE], ids=["empty", "golden"])
@pytest.mark.parametrize("prompt", PROMPTS)
def test_offline_plan_is_valid_and_labelled(prompt, graph):
    plan = mock_planner.plan_offline(prompt, graph)
    assert plan["summary"].startswith("Offline draft (rule-based, no model):")
    assert plan["ops"], "starter prompts must produce changes"
    assert ops.validate_ops(graph, plan["ops"])["ok"] is True
    for node in _added(plan):
        if node["type"] == "agent":
            assert node["config"]["systemPrompt"].strip()


def test_pt_br_request_chains_researcher_writer_reviewer_then_approval():
    plan = mock_planner.plan_offline("pesquisar, escrever e revisar com aprovação humana", EMPTY)
    added = _added(plan)
    assert [(n["type"], n["label"]) for n in added] == [
        ("agent", "Researcher"),
        ("agent", "Writer"),
        ("agent", "Reviewer"),
        ("hitl", "Approval"),
    ]
    refs = [n["ref"] for n in added]
    connects = [(o["from"], o["to"]) for o in plan["ops"] if o["op"] == "connect"]
    assert connects == list(zip(refs, refs[1:]))


def test_no_keywords_returns_no_ops_and_asks_for_steps():
    plan = mock_planner.plan_offline("hello", BASE)
    assert plan["ops"] == []
    assert "step" in plan["summary"].lower()
    assert plan["summary"].startswith("Offline draft (rule-based, no model):")


def test_qa_adds_agent_and_gate_whose_fail_returns_to_the_agent():
    plan = mock_planner.plan_offline("write then test it", EMPTY)
    added = _added(plan)
    labels = [n["label"] for n in added]
    assert labels == ["Writer", "QA", "QA Gate"]
    qa_ref, gate_ref = added[1]["ref"], added[2]["ref"]
    fail = [o for o in plan["ops"] if o["op"] == "connect" and o["from"] == gate_ref and o.get("fromPort") == "fail"]
    assert [o["to"] for o in fail] == [qa_ref]
    assert "pass" in added[2]["config"]["checklist"] or "verdict" in added[2]["config"]["checklist"]
    assert added[2]["config"]["checklist"] == (
        "- QA verdict is pass\n- Evidence is attached for every item\n- No open blocker remains"
    )


def test_agent_prompt_uses_the_pinned_template():
    plan = mock_planner.plan_offline("research and write", EMPTY)
    researcher, writer = _added(plan)
    assert researcher["config"]["systemPrompt"] == (
        "You are the Researcher agent.\nGoal: Collect relevant, cited facts for the task.\n\n"
        "How to work:\n- Stay within this goal; ask for missing inputs instead of guessing.\n"
        "- Keep output concise and structured.\n\n"
        "Hand-off: finish with a one-line verdict for the next step (Writer)."
    )
    assert writer["config"]["systemPrompt"].endswith("(the next step).")
    assert mock_planner.OFFLINE_AGENT_PROMPT.startswith("You are the {label} agent.")


def test_attaches_after_the_current_terminal_and_inserts_before_a_terminal_hitl():
    graph = {
        "nodes": [{"id": "a1", "type": "agent", "label": "Writer", "config": {}}],
        "edges": [],
    }
    plan = mock_planner.plan_offline("add a review step", graph)
    assert {"op": "connect", "from": "a1", "to": plan["ops"][0]["ref"]} in plan["ops"]

    plan = mock_planner.plan_offline("Add a review step before approval", BASE)
    assert plan["ops"][0] == {"op": "disconnect", "from": "g1", "fromPort": "pass", "to": "h1"} or any(
        o["op"] == "disconnect" and o["to"] == "h1" for o in plan["ops"]
    )
    result = ops.validate_ops(BASE, plan["ops"])
    assert result["ok"] is True
    edges = {(e["source"], e["target"]) for e in result["graph"]["edges"]}
    assert ("g1", "h1") not in edges
    assert any(t == "h1" and s.startswith("ref:") for s, t in edges)
    hitl_nodes = [n for n in result["graph"]["nodes"] if n["type"] == "hitl"]
    assert len(hitl_nodes) == 1, "an existing approval is reused, not duplicated"


def test_refs_never_collide_with_existing_node_ids():
    graph = {
        "nodes": [
            {"id": "n1", "type": "agent", "label": "Writer", "config": {}},
            {"id": "ref:n2", "type": "agent", "label": "Odd", "config": {}},
        ],
        "edges": [],
    }
    plan = mock_planner.plan_offline("plan research", graph)
    refs = [o["ref"] for o in plan["ops"] if o["op"] == "addNode"]
    assert refs and "n1" not in refs and "n2" not in refs
    assert ops.validate_ops(graph, plan["ops"])["ok"] is True


def test_a_graph_with_no_room_for_more_wires_returns_no_ops():
    nodes = [{"id": f"a{i}", "type": "agent", "label": f"A{i}", "config": {}} for i in range(16)]
    edges = [
        {"source": nodes[i]["id"], "sourceHandle": "out", "target": nodes[j]["id"], "targetHandle": "in"}
        for i in range(16)
        for j in range(16)
        if i != j
    ][:120]
    nodes.append({"id": "tail", "type": "agent", "label": "Tail", "config": {}})
    plan = mock_planner.plan_offline("research write review", {"nodes": nodes, "edges": edges})
    assert plan["ops"] == []
    assert "full" in plan["summary"].lower()


def test_full_graph_returns_no_ops_instead_of_an_invalid_plan():
    graph = {
        "nodes": [{"id": f"a{i}", "type": "agent", "label": f"A{i}", "config": {}} for i in range(60)],
        "edges": [],
    }
    plan = mock_planner.plan_offline("research write review", graph)
    assert plan["ops"] == []
    assert "full" in plan["summary"].lower() or "limit" in plan["summary"].lower()
