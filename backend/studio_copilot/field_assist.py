"""Field assist (plan S4): request model and the deterministic offline assistant.

Offline output is pinned by tests. Live providers arrive with S6 and reuse
`AssistRequest`.
"""
from __future__ import annotations

import re
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from . import catalog, redaction

# Copied from mock_planner.OFFLINE_AGENT_PROMPT: S1 and S4 ran in parallel.
AGENT_PROMPT = (
    "You are the {label} agent.\n"
    "Goal: {goal}\n\n"
    "How to work:\n"
    "- Stay within this goal; ask for missing inputs instead of guessing.\n"
    "- Keep output concise and structured.\n\n"
    "Hand-off: finish with a one-line verdict for the next step ({next})."
)
SKILL_PROMPT = (
    "Skill: {label}\nDoes: {goal}\n\n"
    "Inputs: what the calling agent provides.\n"
    "Output: a short result the agent can use directly.\n"
    "Use when: an agent needs exactly this capability."
)
GATE_CHECKLIST = "- {goal}\n- Evidence is attached for every item\n- No open blocker remains"

DRAFT_NOTE = "Drafted offline from your intent — edit freely."


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class AssistNode(_Strict):
    type: str = Field(min_length=1, max_length=40)
    label: str = Field(max_length=60)
    roleId: str | None = Field(default=None, max_length=40)
    skillId: str | None = Field(default=None, max_length=40)
    gateId: str | None = Field(default=None, max_length=40)


class Neighbour(_Strict):
    direction: Literal["in", "out"]
    type: str = Field(max_length=40)
    label: str = Field(max_length=60)
    port: str = Field(max_length=40)


class AssistRequest(_Strict):
    field: Literal["systemPrompt", "checklist"]
    action: Literal["draft", "improve", "review"]
    node: AssistNode
    current: str = Field(default="", max_length=8000)
    intent: str = Field(default="", max_length=500)
    focus: str = Field(default="", max_length=1000)
    neighbours: list[Neighbour] = Field(default_factory=list, max_length=8)
    harnessName: str = Field(default="", max_length=80)
    mode: Literal["mock", "live", "local"]
    connection_id: str | None = Field(default=None, max_length=200)


def _sentence(text: str) -> str:
    text = text.strip()
    return text if text.endswith(".") else f"{text}."


def _draft(req: AssistRequest) -> dict[str, Any]:
    goal = _sentence(req.intent)
    label = req.node.label
    if req.field == "checklist":
        text = GATE_CHECKLIST.format(goal=goal)
    elif req.node.type == "skill":
        text = SKILL_PROMPT.format(label=label, goal=goal)
    else:
        following = ", ".join(n.label for n in req.neighbours if n.direction == "out") or "the next step"
        text = AGENT_PROMPT.format(label=label, goal=goal, next=following)
    return {"text": text, "notes": [DRAFT_NOTE]}


_GOAL_LINE = re.compile(r"^(Goal|Does):", re.MULTILINE)
_BULLETS = ("- ", "* ", "• ")


def _improve(req: AssistRequest) -> dict[str, Any]:
    original = req.current
    text = "\n".join(line.strip() for line in original.splitlines())
    text = re.sub(r"\n{3,}", "\n\n", text).strip()
    notes: list[str] = []
    if text != original:
        notes.append("Normalised spacing.")
    if req.field == "systemPrompt" and req.node.type in ("agent", "skill") and not _GOAL_LINE.search(text):
        focus = " ".join(req.focus.split()) or "State the goal here."
        text = f"Goal: {focus}\n{text}".rstrip()
        notes.append("Added a Goal line.")
    if req.field == "checklist":
        lines = [ln if not ln or ln.startswith(_BULLETS) else f"- {ln}" for ln in text.split("\n")]
        converted = "\n".join(lines)
        if converted != text:
            text = converted
            notes.append("Turned lines into checklist items.")
    limit = catalog.limits()["systemPromptMax" if req.field == "systemPrompt" else "checklistMax"]
    if len(text) > limit:
        # Never hand back text the Inspector could not store: leave the field as it is.
        return {"text": original, "notes": [f"Too long to improve within the {limit}-character limit — shorten it first."]}
    return {"text": text, "notes": notes or ["Already tidy."]}


_HANDOFF = re.compile(r"(?i)hand-?off|verdict|emit|signal|done when|finish")
_ROLE = re.compile(r"(?i)\byou are\b|\brole\b")


def _review(req: AssistRequest) -> dict[str, Any]:
    current = req.current
    notes: list[str] = []
    if len(current.strip()) < 80:
        notes.append("Too short to guide a model — say what good output looks like.")
    if not _HANDOFF.search(current):
        notes.append("Doesn't say how to finish or what to hand off.")
    if req.node.type == "agent" and req.field == "systemPrompt" and not _ROLE.search(current):
        notes.append("Doesn't state the role.")
    if req.field == "checklist" and sum(1 for ln in current.splitlines() if ln.strip()) < 2:
        notes.append("A gate checklist needs at least two checkable items.")
    if redaction.redact(current)[1] > 0:
        notes.append("Contains something that looks like a secret — remove it.")
    return {"text": None, "notes": notes[:5] or ["Looks complete."]}


def assist_offline(req: AssistRequest) -> dict[str, Any]:
    if req.action == "draft":
        return _draft(req)
    if req.action == "improve":
        return _improve(req)
    return _review(req)
