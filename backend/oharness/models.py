from pathlib import Path
from typing import Any

from pydantic import BaseModel, Field

SCHEMA_VERSION = "1.0.0"
SCHEMA_PATH = Path(__file__).resolve().parent / "schema" / "oharness.schema.json"


class Manifest(BaseModel):
    id: str
    name: str
    version: str
    description: str
    license: str
    tags: list[str] = Field(default_factory=list)


class Graph(BaseModel):
    nodes: list[Any] = Field(default_factory=list)
    edges: list[Any] = Field(default_factory=list)


class Content(BaseModel):
    prompts: dict[str, Any] = Field(default_factory=dict)
    agents: dict[str, Any] = Field(default_factory=dict)
    skills: dict[str, Any] = Field(default_factory=dict)
    hooks: dict[str, Any] = Field(default_factory=dict)
    commands: dict[str, Any] = Field(default_factory=dict)
    scripts: dict[str, Any] = Field(default_factory=dict)


class Runtime(BaseModel):
    preferred: str
    cli: str | None = None
    env: list[Any] = Field(default_factory=list)
    secrets: list[Any] = Field(default_factory=list)


class Validation(BaseModel):
    mockProfile: str


class HarnessBundle(BaseModel):
    schemaVersion: str
    manifest: Manifest
    graph: Graph
    content: Content
    runtime: Runtime
    validation: Validation
