from dataclasses import dataclass, field
from pathlib import Path
import json

from jsonschema import Draft202012Validator

from .models import SCHEMA_PATH, HarnessBundle


@dataclass
class ValidateResult:
    ok: bool
    errors: list[str] = field(default_factory=list)


def _graph_errors(graph: dict) -> list[str]:
    errors: list[str] = []
    nodes = graph.get("nodes", [])
    edges = graph.get("edges", [])

    seen: set[str] = set()
    duplicates: set[str] = set()
    node_ids: set[str] = set()

    for index, node in enumerate(nodes):
        if not isinstance(node, dict):
            errors.append(f"graph/nodes/{index}: node must be an object")
            continue
        node_id = node.get("id")
        if not isinstance(node_id, str) or not node_id:
            errors.append(f"graph/nodes/{index}: node must have a non-empty string id")
            continue
        if node_id in seen:
            duplicates.add(node_id)
        seen.add(node_id)
        node_ids.add(node_id)

    for node_id in sorted(duplicates):
        errors.append(f"graph/nodes: duplicate node id '{node_id}'")

    for index, edge in enumerate(edges):
        if not isinstance(edge, dict):
            errors.append(f"graph/edges/{index}: edge must be an object")
            continue
        source = edge.get("source")
        target = edge.get("target")
        if not isinstance(source, str) or source not in node_ids:
            errors.append(
                f"graph/edges/{index}: edge source '{source}' does not reference an existing node"
            )
        if not isinstance(target, str) or target not in node_ids:
            errors.append(
                f"graph/edges/{index}: edge target '{target}' does not reference an existing node"
            )

    return errors


def validate_dict(data: dict) -> ValidateResult:
    schema = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
    validator = Draft202012Validator(schema)
    errs = sorted(validator.iter_errors(data), key=lambda e: list(e.path))
    messages = [f"{'/'.join(map(str, e.path)) or '<'}: {e.message}" for e in errs]
    if messages:
        return ValidateResult(False, messages)

    graph_messages = _graph_errors(data.get("graph", {}))
    if graph_messages:
        return ValidateResult(False, graph_messages)

    try:
        HarnessBundle.model_validate(data)
    except Exception as ex:
        return ValidateResult(False, [str(ex)])
    return ValidateResult(True, [])


def validate_path(path: Path) -> ValidateResult:
    if not path.is_file():
        return ValidateResult(False, [f"file not found: {path}"])
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as ex:
        return ValidateResult(False, [f"invalid JSON: {ex.msg}"])
    if not isinstance(data, dict):
        return ValidateResult(False, ["root document must be a JSON object"])
    return validate_dict(data)
