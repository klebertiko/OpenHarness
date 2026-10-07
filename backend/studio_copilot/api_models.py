"""Pydantic request models for /studio/copilot/plan (plan S1).

Ops are deliberately not modelled here: they are validated by the
hand-written `ops.validate_ops` so error codes stay exact.
"""
from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

MAX_BODY_BYTES = 262144


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class GraphNode(_Strict):
    id: str = Field(min_length=1, max_length=100)
    type: str = Field(min_length=1, max_length=40)
    label: str = Field(max_length=60)
    # Descriptive text only: strings and lists of strings. Nested values are never legitimate
    # and a deeply nested one is a recursion hazard for everything downstream.
    config: dict[str, str | list[str]] = Field(default_factory=dict, max_length=16)


class GraphEdge(_Strict):
    source: str = Field(max_length=100)
    sourceHandle: str = Field(max_length=40)
    target: str = Field(max_length=100)
    targetHandle: str = Field(max_length=40)


class CopilotGraph(_Strict):
    nodes: list[GraphNode] = Field(max_length=60)
    edges: list[GraphEdge] = Field(max_length=120)


class HistoryTurn(_Strict):
    role: Literal["user", "assistant"]
    text: str = Field(max_length=2000)


class PlanRequest(_Strict):
    message: str = Field(min_length=1, max_length=2000)
    history: list[HistoryTurn] = Field(default_factory=list, max_length=6)
    graph: CopilotGraph
    mode: Literal["mock", "live", "local"]
    connection_id: str | None = Field(default=None, max_length=200)
