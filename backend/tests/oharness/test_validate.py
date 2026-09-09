from pathlib import Path

from oharness.validate import validate_dict, validate_path

FIXTURES = Path(__file__).parent / "fixtures"

MINIMAL = {
    "schemaVersion": "1.0.0",
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


def test_valid_hello_ok():
    r = validate_path(FIXTURES / "valid-hello.oharness")
    assert r.ok
    assert r.errors == []


def test_invalid_missing_manifest():
    r = validate_path(FIXTURES / "invalid-missing-manifest.oharness")
    assert not r.ok
    assert any("manifest" in e.lower() for e in r.errors)


def test_extra_top_level_property_rejected():
    data = {**MINIMAL, "unexpected": True}
    r = validate_dict(data)
    assert not r.ok


def test_duplicate_node_ids():
    data = {
        **MINIMAL,
        "graph": {
            "nodes": [{"id": "a"}, {"id": "a"}],
            "edges": [],
        },
    }
    r = validate_dict(data)
    assert not r.ok
    assert any("duplicate" in e.lower() for e in r.errors)


def test_edge_endpoint_must_exist():
    data = {
        **MINIMAL,
        "graph": {
            "nodes": [{"id": "a"}],
            "edges": [{"source": "a", "target": "missing"}],
        },
    }
    r = validate_dict(data)
    assert not r.ok
    assert any("missing" in e.lower() or "endpoint" in e.lower() for e in r.errors)
