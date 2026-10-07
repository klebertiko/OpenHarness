"""Graph-edit op validator (spec §4.3).

Hand-written plain-dict validation so the error codes and the per-op check
order stay exact (tests pin the first error). Ops run sequentially on a deep
copy of the graph; validation stops at the first failing op, so a list either
applies completely or not at all. New nodes created by `addNode` live in the
working copy under the synthetic id `ref:<ref>`.
"""
from __future__ import annotations

import copy
import re
from typing import Any

from . import catalog

ERROR_CODES = (
    "unknown_op",
    "field_invalid",
    "field_not_editable",
    "bad_ref",
    "unknown_type",
    "unknown_node",
    "empty_update",
    "self_loop",
    "bad_port",
    "no_input_port",
    "duplicate_edge",
    "edge_not_found",
    "graph_limit",
    "too_many_ops",
)

_REF_RE = re.compile(r"^n[0-9]{1,3}$")
_ID_FIELD_RE = re.compile(r"^[A-Za-z0-9_.-]{0,40}$")

# op -> (required keys, optional keys, JSON type checks per key)
_STR = str
_OPS: dict[str, tuple[set[str], set[str], dict[str, type]]] = {
    "addNode": ({"op", "ref", "type", "label"}, {"config", "near"}, {"ref": _STR, "type": _STR, "label": _STR, "config": dict, "near": _STR}),
    "updateNode": ({"op", "id"}, {"label", "config"}, {"id": _STR, "label": _STR, "config": dict}),
    "removeNode": ({"op", "id"}, set(), {"id": _STR}),
    "connect": ({"op", "from", "to"}, {"fromPort", "toPort"}, {"from": _STR, "to": _STR, "fromPort": _STR, "toPort": _STR}),
    "disconnect": ({"op", "from", "to"}, {"fromPort", "toPort"}, {"from": _STR, "to": _STR, "fromPort": _STR, "toPort": _STR}),
}


class _Fail(Exception):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


def _fail(code: str, message: str) -> _Fail:
    return _Fail(code, message)


def _shape(op: dict[str, Any], name: str) -> None:
    required, optional, types = _OPS[name]
    keys = set(op)
    missing = required - keys
    if missing:
        raise _fail("field_invalid", f"{name} is missing {', '.join(sorted(missing))}")
    extra = keys - required - optional
    if extra:
        raise _fail("field_invalid", f"{name} has unexpected field {', '.join(sorted(extra))}")
    for key, expected in types.items():
        if key in op and not isinstance(op[key], expected):
            raise _fail("field_invalid", f"{name}.{key} must be a {'string' if expected is str else 'object'}")


class _Working:
    def __init__(self, graph: dict[str, Any]) -> None:
        self.nodes: list[dict[str, Any]] = copy.deepcopy(list(graph.get("nodes", [])))
        self.edges: list[dict[str, Any]] = copy.deepcopy(list(graph.get("edges", [])))
        self.refs: dict[str, str] = {}  # live refs -> synthetic id
        self.used_refs: set[str] = set()
        self.limits = catalog.limits()

    def find(self, node_id: str) -> dict[str, Any] | None:
        by_id = next((n for n in self.nodes if n["id"] == node_id), None)
        if by_id is not None:
            return by_id
        synthetic = self.refs.get(node_id)
        return next((n for n in self.nodes if n["id"] == synthetic), None) if synthetic else None

    def need(self, node_id: str, role: str = "node") -> dict[str, Any]:
        node = self.find(node_id)
        if node is None:
            raise _fail("unknown_node", f"Unknown {role} \"{node_id}\"")
        return node


def _check_label(label: str, limit: int) -> str:
    label = label.strip()
    if not 1 <= len(label) <= limit:
        raise _fail("field_invalid", f"label must be 1–{limit} characters")
    return label


def _check_config(node_type: str, config: dict[str, Any], limits: dict[str, int]) -> None:
    editable = catalog.editable_fields(node_type)
    for key in config:
        if key not in editable:
            raise _fail("field_not_editable", f"\"{key}\" cannot be set on a {node_type}")
    for key, value in config.items():
        if key in ("roleId", "skillId", "gateId"):
            if not isinstance(value, str) or not _ID_FIELD_RE.match(value) or len(value) > limits["idFieldMax"]:
                raise _fail("field_invalid", f"{key} must be up to {limits['idFieldMax']} letters, digits, _ . or -")
        elif key in ("systemPrompt", "checklist", "approvalLabel"):
            limit = limits[{"systemPrompt": "systemPromptMax", "checklist": "checklistMax", "approvalLabel": "approvalLabelMax"}[key]]
            if not isinstance(value, str) or len(value) > limit:
                raise _fail("field_invalid", f"{key} must be text up to {limit} characters")
        elif key in ("emits", "consumes"):
            ok = (
                isinstance(value, list)
                and len(value) <= limits["signalListMax"]
                and all(isinstance(s, str) and 1 <= len(s) <= limits["signalMax"] for s in value)
            )
            if not ok:
                raise _fail("field_invalid", f"{key} must be up to {limits['signalListMax']} signals of 1–{limits['signalMax']} characters")


def _port(node: dict[str, Any], side: str, requested: str | None) -> str:
    ports = catalog.out_ports(node["type"]) if side == "out" else catalog.in_ports(node["type"])
    if requested is None:
        if not ports:
            raise _fail("bad_port", f"{node['label']} has no {side} port")
        return ports[0]
    if requested not in ports:
        raise _fail("bad_port", f"{node['label']} has no {side} port \"{requested}\"")
    return requested


def _endpoints(w: _Working, op: dict[str, Any]) -> tuple[dict[str, Any], str, dict[str, Any], str]:
    src = w.need(op["from"], "source node")
    dst = w.need(op["to"], "target node")
    if src is dst:
        raise _fail("self_loop", f"{src['label']} cannot connect to itself")
    src_port = _port(src, "out", op.get("fromPort"))
    if not catalog.in_ports(dst["type"]):
        raise _fail("no_input_port", f"{dst['label']} has no input port")
    dst_port = _port(dst, "in", op.get("toPort"))
    return src, src_port, dst, dst_port


def _edge_key(src: str, sp: str, dst: str, dp: str) -> tuple[str, str, str, str]:
    return (src, sp, dst, dp)


def _add_node(w: _Working, op: dict[str, Any]) -> None:
    ref = op["ref"]
    if not _REF_RE.match(ref) or ref in w.used_refs or any(n["id"] == ref for n in w.nodes):
        raise _fail("bad_ref", f"ref \"{ref}\" must look like n1, n2, … and be unused")
    if op["type"] not in catalog.node_types():
        raise _fail("unknown_type", f"Unknown node type \"{op['type']}\"")
    label = _check_label(op["label"], w.limits["labelMax"])
    config = op.get("config", {})
    _check_config(op["type"], config, w.limits)
    if "near" in op:
        w.need(op["near"], "near node")
    if len(w.nodes) + 1 > w.limits["maxNodes"]:
        raise _fail("graph_limit", f"A graph holds at most {w.limits['maxNodes']} nodes")
    synthetic = f"ref:{ref}"
    w.refs[ref] = synthetic
    w.used_refs.add(ref)
    w.nodes.append({"id": synthetic, "type": op["type"], "label": label, "config": copy.deepcopy(config)})


def _update_node(w: _Working, op: dict[str, Any]) -> None:
    node = w.need(op["id"])
    config = op.get("config") or {}
    if "label" not in op and not config:
        raise _fail("empty_update", "updateNode needs a label or at least one config field")
    label = _check_label(op["label"], w.limits["labelMax"]) if "label" in op else None
    _check_config(node["type"], config, w.limits)
    if label is not None:
        node["label"] = label
    node.setdefault("config", {}).update(copy.deepcopy(config))


def _remove_node(w: _Working, op: dict[str, Any]) -> None:
    node = w.need(op["id"])
    w.nodes = [n for n in w.nodes if n is not node]
    w.edges = [e for e in w.edges if node["id"] not in (e["source"], e["target"])]
    w.refs = {r: i for r, i in w.refs.items() if i != node["id"]}


def _connect(w: _Working, op: dict[str, Any]) -> None:
    src, sp, dst, dp = _endpoints(w, op)
    key = _edge_key(src["id"], sp, dst["id"], dp)
    if any(_edge_key(e["source"], e["sourceHandle"], e["target"], e["targetHandle"]) == key for e in w.edges):
        raise _fail("duplicate_edge", f"{src['label']} → {dst['label']} is already connected")
    if len(w.edges) + 1 > w.limits["maxEdges"]:
        raise _fail("graph_limit", f"A graph holds at most {w.limits['maxEdges']} edges")
    w.edges.append({"source": src["id"], "sourceHandle": sp, "target": dst["id"], "targetHandle": dp})


def _disconnect(w: _Working, op: dict[str, Any]) -> None:
    src = w.need(op["from"], "source node")
    dst = w.need(op["to"], "target node")
    sp = _port(src, "out", op.get("fromPort"))
    dp = _port(dst, "in", op.get("toPort"))
    key = _edge_key(src["id"], sp, dst["id"], dp)
    keep = [e for e in w.edges if _edge_key(e["source"], e["sourceHandle"], e["target"], e["targetHandle"]) != key]
    if len(keep) == len(w.edges):
        raise _fail("edge_not_found", f"{src['label']} → {dst['label']} is not connected")
    w.edges = keep


_HANDLERS = {
    "addNode": _add_node,
    "updateNode": _update_node,
    "removeNode": _remove_node,
    "connect": _connect,
    "disconnect": _disconnect,
}


def validate_ops(graph: dict[str, Any], ops: list[Any]) -> dict[str, Any]:
    """Return `{"ok": True, "graph"}` or `{"ok": False, "errors": [one error]}`."""
    max_ops = catalog.limits()["maxOps"]
    if len(ops) > max_ops:
        return {"ok": False, "errors": [{"index": max_ops, "code": "too_many_ops", "message": f"At most {max_ops} changes per proposal"}]}
    work = _Working(graph)
    for index, op in enumerate(ops):
        try:
            name = op.get("op") if isinstance(op, dict) else None
            if name not in _OPS:
                raise _fail("unknown_op", f"Unknown change \"{name}\"" if isinstance(name, str) else "Each change must be an object with an op")
            _shape(op, name)
            _HANDLERS[name](work, op)
        except _Fail as err:
            return {"ok": False, "errors": [{"index": index, "code": err.code, "message": err.message}]}
    return {"ok": True, "graph": {"nodes": work.nodes, "edges": work.edges}}
