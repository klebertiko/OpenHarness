import json
from pathlib import Path

from oharness.mock_run import plan_mock_run
from oharness.models import HarnessBundle

TEST_FIXTURES = Path(__file__).parent / "fixtures"
PKG_FIXTURES = Path(__file__).resolve().parents[2] / "oharness" / "fixtures"
HELLO = TEST_FIXTURES / "valid-hello.oharness"
DEFAULT = PKG_FIXTURES / "default-agile.oharness"


def _load_bundle(path: Path) -> HarnessBundle:
    data = json.loads(path.read_text(encoding="utf-8"))
    return HarnessBundle.model_validate(data)


def _index_by_node(steps):
    return {step.nodeId: i for i, step in enumerate(steps)}


def test_plan_mock_run_hello_empty_graph():
    bundle = _load_bundle(HELLO)
    report = plan_mock_run(bundle)

    assert report.ok is True
    assert report.steps == []


def test_plan_mock_run_default_agile_no_cycle():
    bundle = _load_bundle(DEFAULT)
    report = plan_mock_run(bundle)

    assert report.ok is True
    assert len(report.steps) == 8
    assert all(step.status == "planned" for step in report.steps)
    assert {step.nodeId for step in report.steps} == {
        "PO",
        "SM",
        "BE",
        "FE",
        "QA",
        "ARCH",
        "TW",
        "SEC",
    }
    assert all(step.role == step.nodeId for step in report.steps)

    order = _index_by_node(report.steps)
    for edge in bundle.graph.edges:
        assert order[edge["source"]] < order[edge["target"]]


def test_plan_mock_run_cycle_not_ok():
    bundle = HarnessBundle.model_validate(
        {
            "schemaVersion": "1.0.0",
            "manifest": {
                "id": "cycle",
                "name": "Cycle",
                "version": "0.1.0",
                "description": "min",
                "license": "MIT",
                "tags": [],
            },
            "graph": {
                "nodes": [{"id": "A", "role": "A"}, {"id": "B", "role": "B"}],
                "edges": [{"source": "A", "target": "B"}, {"source": "B", "target": "A"}],
            },
            "content": {
                "prompts": {},
                "agents": {},
                "skills": {},
                "hooks": {},
                "commands": {},
                "scripts": {},
            },
            "runtime": {"preferred": "api", "cli": None, "env": [], "secrets": []},
            "validation": {"mockProfile": "default"},
        }
    )

    report = plan_mock_run(bundle)

    assert report.ok is False
    assert len(report.steps) == 2
    assert all(step.status == "skipped" for step in report.steps)
