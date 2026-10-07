"""Deterministic offline planner (spec §5.4): keyword rules, no model.

Scans the message (pt-BR and English) for role keywords in order of first
appearance, chains the matching blocks, and attaches the chain after the
graph's current terminal. Every plan it returns must pass `ops.validate_ops`.
"""
from __future__ import annotations

import re
from typing import Any

from . import catalog

PREFIX = "Offline draft (rule-based, no model):"

OFFLINE_AGENT_PROMPT = (
    "You are the {label} agent.\n"
    "Goal: {goal}\n\n"
    "How to work:\n"
    "- Stay within this goal; ask for missing inputs instead of guessing.\n"
    "- Keep output concise and structured.\n\n"
    "Hand-off: finish with a one-line verdict for the next step ({next})."
)

GOALS = {
    "Planner": "Break the request into ordered, checkable steps.",
    "Researcher": "Collect relevant, cited facts for the task.",
    "Writer": "Produce the requested draft from the inputs.",
    "Reviewer": "Review the previous output and list concrete fixes.",
    "QA": "Verify the work against its acceptance criteria.",
    "Security": "Check the work for security risks and leaked secrets.",
}

CHECKLIST = "- {agent} verdict is pass\n- Evidence is attached for every item\n- No open blocker remains"

# (key, pattern) in the order the spec lists them; position decides chain order.
_RULES = [
    ("Planner", re.compile(r"\b(plan|planej)")),
    ("Researcher", re.compile(r"\b(research|pesquis)")),
    ("Writer", re.compile(r"\b(write|escrev|draft|redig)")),
    ("Reviewer", re.compile(r"\b(review|revis)")),
    ("QA", re.compile(r"\b(test|teste|qa)")),
    ("Security", re.compile(r"\b(secur|seguran)")),
]
_APPROVAL = re.compile(r"\b(approv|aprov|human|humano|merge)")
_FLOW = ("agent", "gate", "hitl")


def _empty(summary: str) -> dict[str, Any]:
    return {"summary": f"{PREFIX} {summary}", "ops": []}


def _terminals(graph: dict[str, Any]) -> list[dict[str, Any]]:
    sources = {e["source"] for e in graph.get("edges", [])}
    return [n for n in graph.get("nodes", []) if n.get("type") in _FLOW and n["id"] not in sources]


def _plan_items(message: str) -> tuple[list[tuple[str, str, str]], bool]:
    """Return ([(kind, label, agent_label)], wants_approval), in chain order."""
    low = message.lower()
    hits = sorted(
        ((m.start(), key) for key, pattern in _RULES if (m := pattern.search(low))),
        key=lambda h: h[0],
    )
    items: list[tuple[str, str, str]] = []
    for _, key in hits:
        items.append(("agent", key, key))
        if key in ("QA", "Security"):
            items.append(("gate", f"{key} Gate", key))
    return items, bool(_APPROVAL.search(low))


def plan_offline(message: str, graph: dict[str, Any]) -> dict[str, Any]:
    items, wants_approval = _plan_items(message)
    if not items and not wants_approval:
        return _empty("I couldn't find steps to add. Name the steps you want, for example plan, research, write, review, test, security or approval.")

    nodes = graph.get("nodes", [])
    edges = graph.get("edges", [])
    limits = catalog.limits()

    terminals = _terminals(graph)
    non_hitl = [n for n in terminals if n["type"] != "hitl"]
    hitl_terminals = [n for n in terminals if n["type"] == "hitl"]

    existing_hitl = hitl_terminals[-1] if not non_hitl and hitl_terminals else None
    if wants_approval and any(n.get("type") == "hitl" for n in nodes) and existing_hitl is not None:
        wants_approval = False  # reuse the approval that already ends the flow
    if wants_approval:
        items.append(("hitl", "Approval", "Approval"))
    if not items:
        return _empty("This graph already ends with an approval step, so there is nothing to add.")

    if len(nodes) + len(items) > limits["maxNodes"]:
        return _empty(f"The graph is full ({limits['maxNodes']} node limit), so I can't add more steps.")

    chain: list[dict[str, Any]] = []
    out: list[dict[str, Any]] = []
    for position, (kind, label, agent_label) in enumerate(items):
        ref = f"n{position + 1}"
        following = items[position + 1][1] if position + 1 < len(items) else None
        if kind == "agent":
            config: dict[str, Any] = {
                "roleId": label.lower(),
                "systemPrompt": OFFLINE_AGENT_PROMPT.format(
                    label=label, goal=GOALS[label], next=following or "the next step"
                ),
            }
        elif kind == "gate":
            config = {"gateId": label.lower().replace(" ", "-"), "checklist": CHECKLIST.format(agent=agent_label)}
        else:
            config = {"approvalLabel": "Approve"}
        chain.append({"ref": ref, "kind": kind, "label": label})
        out.append({"op": "addNode", "ref": ref, "type": kind, "label": label, "config": config})

    def connect(src: str, dst: str, port: str | None = None) -> dict[str, Any]:
        op: dict[str, Any] = {"op": "connect", "from": src, "to": dst}
        if port:
            op["fromPort"] = port
        return op

    # Attach point: after the last non-HITL terminal, else in front of a terminal HITL.
    anchor = non_hitl[-1] if non_hitl else None
    first, last = chain[0]["ref"], chain[-1]["ref"]
    insert_before = existing_hitl if anchor is None and existing_hitl is not None else None

    if anchor is not None:
        used = {e["sourceHandle"] for e in edges if e["source"] == anchor["id"]}
        free = [p for p in catalog.out_ports(anchor["type"]) if p not in used]
        if free:
            out.append(connect(anchor["id"], first, free[0] if anchor["type"] != "agent" else None))
    elif insert_before is not None:
        incoming = next((e for e in edges if e["target"] == insert_before["id"]), None)
        if incoming is not None:
            out.append({"op": "disconnect", "from": incoming["source"], "fromPort": incoming["sourceHandle"], "to": insert_before["id"]})
            out.append(connect(incoming["source"], first, incoming["sourceHandle"]))

    for index in range(len(chain) - 1):
        cur, nxt = chain[index], chain[index + 1]
        if cur["kind"] == "gate":
            out.append(connect(cur["ref"], nxt["ref"], "pass"))
            out.append(connect(cur["ref"], chain[index - 1]["ref"], "fail"))
        else:
            out.append(connect(cur["ref"], nxt["ref"]))
    if chain[-1]["kind"] == "gate":
        out.append(connect(last, chain[-2]["ref"], "fail"))
    if insert_before is not None:
        out.append(connect(last, insert_before["id"], "pass" if chain[-1]["kind"] == "gate" else None))

    added = ", ".join(c["label"] for c in chain)
    summary = f"{PREFIX} added {added}."
    if insert_before is not None:
        summary += f" They sit before \"{insert_before['label']}\"."
    return {"summary": summary, "ops": out}
