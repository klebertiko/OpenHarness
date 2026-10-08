"""ProbeResult.models is a plain list of model-id strings (one declaration)."""

from __future__ import annotations

import ast
import inspect
import typing

import adapters.base as base


def test_probe_result_declares_models_exactly_once_as_list_of_str() -> None:
    tree = ast.parse(inspect.getsource(base))
    cls = next(n for n in tree.body if isinstance(n, ast.ClassDef) and n.name == "ProbeResult")
    decls = [n for n in cls.body if isinstance(n, ast.AnnAssign) and getattr(n.target, "id", "") == "models"]
    assert len(decls) == 1
    assert typing.get_type_hints(base.ProbeResult)["models"] == list[str]
