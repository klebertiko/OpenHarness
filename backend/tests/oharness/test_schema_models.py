import pytest
from pydantic import ValidationError

from oharness.models import HarnessBundle, SCHEMA_VERSION


def test_minimal_bundle_parses():
    raw = {
        "schemaVersion": SCHEMA_VERSION,
        "manifest": {
            "id": "hello",
            "name": "Hello",
            "version": "0.1.0",
            "description": "min",
            "license": "MIT",
            "tags": [],
        },
        "graph": {"nodes": [], "edges": []},
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
    bundle = HarnessBundle.model_validate(raw)
    assert bundle.manifest.id == "hello"
    assert bundle.schemaVersion == SCHEMA_VERSION


def _minimal(graph: dict) -> dict:
    return {
        "schemaVersion": SCHEMA_VERSION,
        "manifest": {
            "id": "hello",
            "name": "Hello",
            "version": "0.1.0",
            "description": "min",
            "license": "MIT",
            "tags": [],
        },
        "graph": graph,
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


def test_graph_nodes_and_edges_stay_plain_dicts_after_validation():
    # oharness/mock_run.py's `isinstance(n, dict)` duck-typing (P2-adjacent,
    # out of scope for the YAML migration) depends on this: Graph.nodes/
    # edges must still be plain `dict` instances after pydantic validation,
    # not a Node/Edge model instance, even though the field type is now the
    # more precise `list[dict[str, Any]]` (models.py).
    bundle = HarnessBundle.model_validate(
        _minimal({"nodes": [{"id": "a", "extra": {"nested": [1, 2]}}], "edges": []})
    )
    assert isinstance(bundle.graph.nodes[0], dict)
    assert bundle.graph.nodes[0] == {"id": "a", "extra": {"nested": [1, 2]}}


def test_graph_rejects_non_object_node_items():
    # Previously `list[Any]` accepted anything, including a bare string,
    # silently. `list[dict[str, Any]]` now rejects it at the model layer
    # with a clear diagnostic instead of passing it through to mock_run.py.
    with pytest.raises(ValidationError, match="graph.nodes"):
        HarnessBundle.model_validate(_minimal({"nodes": ["not-an-object"], "edges": []}))
