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
