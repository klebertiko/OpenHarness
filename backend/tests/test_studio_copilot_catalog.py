"""Frozen-contract smoke test for studio_copilot.catalog (spec §4.3)."""
import json
from pathlib import Path

from studio_copilot import catalog

EXAMPLES = Path(catalog.__file__).resolve().parent / "contract_examples.json"


def test_catalog_lists_the_six_authorable_types_and_never_decision():
    assert catalog.node_types() == ["agent", "gate", "hitl", "skill", "mcp", "tool"]
    assert catalog.node_spec("decision") is None


def test_ports_match_the_frontend_port_schema():
    assert catalog.out_ports("gate") == ["pass", "fail"]
    assert catalog.out_ports("hitl") == ["approve", "reject"]
    assert catalog.in_ports("skill") == [] and catalog.in_ports("mcp") == [] and catalog.in_ports("tool") == []


def test_no_credential_or_execution_field_is_ever_editable():
    forbidden = {"providerIds", "providerRoutes", "adapter", "model", "endpoint", "secretRef", "apiKey",
                 "mcpCommand", "mcpUrl", "connectorIds", "toolKind", "tokenLimit", "maxTokens", "temperature"}
    for t in catalog.node_types():
        assert forbidden.isdisjoint(catalog.editable_fields(t)), t


def test_assistable_fields_are_editable_fields():
    for t in catalog.node_types():
        assert set(catalog.assistable_fields(t)) <= set(catalog.editable_fields(t)), t


def test_golden_examples_file_is_well_formed():
    data = json.loads(EXAMPLES.read_text(encoding="utf-8"))
    names = [c["name"] for c in data["cases"]]
    assert len(names) == len(set(names)) == 32
    for c in data["cases"]:
        assert isinstance(c["ops"], list) and "ok" in c["expect"]
