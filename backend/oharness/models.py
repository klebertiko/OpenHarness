from pathlib import Path
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

# schemaVersion matrix (docs/adr/0003-ohm-yaml.md "Contrato de preservacao"):
# this backend constant is the only place that currently emits/validates a
# concrete default. `frontend/src/lib/types.ts` (composeBundleFromCanvas)
# separately falls back to "1.1.0" when composing a bundle from the canvas
# with no base version, and to the base bundle's own "1.0.0" when one exists
# -- that divergence is pre-existing (ohm-yaml-migration.md P1 step 1) and is
# out of scope for this backend-only change: reconciling it means picking one
# fallback across both runtimes, which is a frontend-owned file this task
# does not touch. Moving OHM's canonical serialization from JSON to YAML does
# NOT, by itself, bump this value -- schemaVersion identifies the *data*
# contract, not the encoding (ADR 0003).
SCHEMA_VERSION = "1.0.0"
SCHEMA_PATH = Path(__file__).resolve().parent / "schema" / "oharness.schema.json"


class Manifest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    name: str
    version: str
    description: str
    license: str
    tags: list[str] = Field(default_factory=list)


class Graph(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # Each node/edge must be a JSON object -- but its shape is intentionally
    # *not* pinned to a fixed set of fields here. The catalog (Agent, Gate,
    # HITL, Skill, Signal; CONTEXT.md) binds authoring fields -- data,
    # Provider config, Signals, handles, position -- that this layer must
    # preserve verbatim rather than strip to a known subset (ADR 0003
    # "Contrato de preservacao"). `dict[str, Any]` still rejects a
    # structurally-invalid item (e.g. a bare string or number in the nodes
    # array) instead of silently accepting it like the previous `list[Any]`
    # did; oharness/validate.py's `_graph_errors` layers the stricter
    # id/source/target checks (required, non-empty, referential integrity)
    # on top with diagnostics instead of a bare pydantic error. This keeps
    # `HarnessBundle.graph.nodes`/`.edges` plain `list[dict]` at runtime, so
    # oharness/mock_run.py's `isinstance(n, dict)` duck-typing (P2-adjacent,
    # out of scope here) keeps working unchanged.
    nodes: list[dict[str, Any]] = Field(default_factory=list)
    edges: list[dict[str, Any]] = Field(default_factory=list)


class Content(BaseModel):
    model_config = ConfigDict(extra="forbid")

    prompts: dict[str, Any] = Field(default_factory=dict)
    agents: dict[str, Any] = Field(default_factory=dict)
    skills: dict[str, Any] = Field(default_factory=dict)
    hooks: dict[str, Any] = Field(default_factory=dict)
    commands: dict[str, Any] = Field(default_factory=dict)
    scripts: dict[str, Any] = Field(default_factory=dict)


class Runtime(BaseModel):
    model_config = ConfigDict(extra="forbid")

    preferred: str
    cli: str | None = None
    env: list[Any] = Field(default_factory=list)
    secrets: list[Any] = Field(default_factory=list)


class Validation(BaseModel):
    model_config = ConfigDict(extra="forbid")

    mockProfile: str


class HarnessBundle(BaseModel):
    model_config = ConfigDict(extra="forbid")

    schemaVersion: str
    manifest: Manifest
    graph: Graph
    content: Content
    runtime: Runtime
    validation: Validation
