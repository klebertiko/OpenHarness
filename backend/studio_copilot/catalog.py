"""Frozen node catalogue for Studio Copilot and field assist.

`catalog.json` mirrors `frontend/src/lib/ports.ts` (PORTS) and
`frontend/src/lib/templates.ts` (NODE_TEMPLATES); the TypeScript side is
canonical and a vitest parity test fails on drift. Located next to this
module, the same way `oharness/models.py` finds its schema, so the PyInstaller
sidecar needs one `--add-data` line (scripts/build-sidecar.mjs).

`decision` (ADR-0005, experimental) is deliberately absent: the copilot never
creates or wires it.
"""
from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any

CATALOG_PATH = Path(__file__).resolve().parent / "catalog.json"


@lru_cache(maxsize=1)
def load_catalog() -> dict[str, Any]:
    return json.loads(CATALOG_PATH.read_text(encoding="utf-8"))


def limits() -> dict[str, int]:
    return load_catalog()["limits"]


def node_types() -> list[str]:
    return [n["type"] for n in load_catalog()["nodes"]]


def node_spec(node_type: str) -> dict[str, Any] | None:
    return next((n for n in load_catalog()["nodes"] if n["type"] == node_type), None)


def in_ports(node_type: str) -> list[str]:
    spec = node_spec(node_type)
    return list(spec["ports"]["in"]) if spec else []


def out_ports(node_type: str) -> list[str]:
    spec = node_spec(node_type)
    return list(spec["ports"]["out"]) if spec else []


def editable_fields(node_type: str) -> list[str]:
    spec = node_spec(node_type)
    return list(spec["editable"]) if spec else []


def assistable_fields(node_type: str) -> list[str]:
    return list(load_catalog()["assistableFields"].get(node_type, []))
