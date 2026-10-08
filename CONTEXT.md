# OpenHarness

Desktop Agent + Harness Design Studio: run agents against Providers, and author harnesses as an Open Harness Model (`.ohm`).

## Language

### Model

**Open Harness Model (OHM)**:
The portable JSON document that describes a harness — graph, content, connectors, and runtime. File extension `.ohm`.
_Avoid_: oharness file, wallet bundle, pipeline JSON

**Harness**:
A composed system of Agents, Gates, HITL, Skills, and Signals that orchestrates work.
_Avoid_: workflow (ambiguous with BPM), pipeline, agent chain

### Flow pieces (canvas)

**Agent**:
A role-bound actor with a profile, exit signals, and optional provider/tool bindings (e.g. PO, BE, QA).
_Avoid_: LLM node, worker, bot

**Gate**:
A blocking checkpoint with checklist, PASS/FAIL exits, and routing (e.g. Stop-the-Line, QA Gate).
_Avoid_: if-node, router, evaluator (as the primary name)

**HITL**:
The human authority piece — merge, Sprint Goal confirmation, acceptance. Distinct from Agent.
_Avoid_: human-in-the-loop node as a generic Agent, approval widget

**Skill**:
A named capability an Agent may invoke or that may appear as a canvas node (e.g. `tdd`, `hallmark`).
_Avoid_: plugin, prompt pack (unless referring only to content)

**Signal**:
A typed exit-state on an edge (e.g. `"Ready for QA"`). Agents and Gates emit and consume Signals; they do not call each other directly.
_Avoid_: unlabeled edge, message, event (unless domain event elsewhere)

### Connections

**McpServer**:
A connector that exposes MCP tools/resources to bound Agents.
_Avoid_: tool node as synonym for MCP

**Tool**:
A native (non-MCP) capability an Agent may call (HTTP, shell, repo, …).
_Avoid_: function, action

**Connector**:
Either an McpServer or a Tool in the Connections dock.
_Avoid_: integration, plugin

### Providers

**Provider**:
A registered LLM backend (cloud or local) with credentials. Agents and Skills bind **1..N** Providers (primary + fallbacks; optional task routing).
_Avoid_: wallet, model host, adapter (UI copy — adapter remains an internal runtime term)

## Dogfood

The skills-framework Agile harness (`engineering/harness`) is the proving preset: if OHM pieces cannot rebuild it, the catalog is wrong.
