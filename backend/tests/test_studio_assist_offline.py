"""Offline field assistant — pinned drafts, improve and review rules (plan S4)."""
from __future__ import annotations

import pytest

from studio_copilot import field_assist as fa


def _req(**over):
    base = {
        "field": "systemPrompt",
        "action": "draft",
        "node": {"type": "agent", "label": "Reviewer"},
        "current": "",
        "intent": "review pull requests for test coverage",
        "neighbours": [],
        "mode": "mock",
    }
    base.update(over)
    return fa.AssistRequest.model_validate(base)


def test_agent_prompt_draft_is_pinned():
    out = fa.assist_offline(_req(neighbours=[
        {"direction": "out", "type": "gate", "label": "QA Gate", "port": "in"},
        {"direction": "in", "type": "agent", "label": "Writer", "port": "out"},
        {"direction": "out", "type": "hitl", "label": "Approval", "port": "in"},
    ]))
    assert out["text"] == (
        "You are the Reviewer agent.\n"
        "Goal: review pull requests for test coverage.\n\n"
        "How to work:\n- Stay within this goal; ask for missing inputs instead of guessing.\n"
        "- Keep output concise and structured.\n\n"
        "Hand-off: finish with a one-line verdict for the next step (QA Gate, Approval)."
    )
    assert out["notes"] == ["Drafted offline from your intent — edit freely."]


def test_agent_draft_without_out_neighbours_and_with_existing_period():
    out = fa.assist_offline(_req(intent="  Triage bugs.  "))
    assert "Goal: Triage bugs.\n" in out["text"]
    assert out["text"].endswith("(the next step).")


def test_skill_prompt_draft_is_pinned():
    out = fa.assist_offline(_req(node={"type": "skill", "label": "tdd"}, intent="write failing tests first"))
    assert out["text"] == (
        "Skill: tdd\nDoes: write failing tests first.\n\n"
        "Inputs: what the calling agent provides.\nOutput: a short result the agent can use directly.\n"
        "Use when: an agent needs exactly this capability."
    )


def test_gate_checklist_draft_is_pinned():
    out = fa.assist_offline(_req(field="checklist", node={"type": "gate", "label": "Gate"}, intent="Tests pass"))
    assert out["text"] == "- Tests pass.\n- Evidence is attached for every item\n- No open blocker remains"


def test_improve_normalises_and_adds_a_goal_line():
    out = fa.assist_offline(_req(action="improve", current="  You are QA.\n\n\n\nCheck tests. ", intent=""))
    assert out["text"] == "Goal: State the goal here.\nYou are QA.\n\nCheck tests."
    assert "Normalised spacing." in out["notes"]
    assert "Added a Goal line." in out["notes"]


def test_improve_uses_focus_as_the_goal_on_one_line():
    out = fa.assist_offline(_req(action="improve", current="You are QA.", focus="Too short.\nNo hand-off."))
    assert out["text"].splitlines()[0] == "Goal: Too short. No hand-off."


def test_improve_keeps_an_existing_goal_or_does_line():
    out = fa.assist_offline(_req(action="improve", current="Goal: ship it\nYou are QA, finish with a verdict."))
    assert "Added a Goal line." not in out["notes"]
    out = fa.assist_offline(_req(node={"type": "skill", "label": "s"}, action="improve", current="Does: x"))
    assert out["notes"] == ["Already tidy."]


def test_improve_turns_checklist_lines_into_bullets():
    out = fa.assist_offline(_req(field="checklist", node={"type": "gate", "label": "G"}, action="improve",
                                 current="Tests pass\n- Docs updated\n* Lint clean"))
    assert out["text"] == "- Tests pass\n- Docs updated\n* Lint clean"
    assert out["notes"] == ["Turned lines into checklist items."]


def test_improve_never_returns_text_over_the_field_limit():
    long = "x" * 3999
    out = fa.assist_offline(_req(action="improve", current=long, focus="y" * 900))
    assert out["text"] == long
    assert len(out["text"]) <= 4000
    assert out["notes"] == ["Too long to improve within the 4000-character limit — shorten it first."]


def test_improve_over_the_checklist_limit_is_left_alone():
    long = "\n".join(f"- item {i}" for i in range(400))
    out = fa.assist_offline(_req(field="checklist", node={"type": "gate", "label": "G"}, action="improve", current=long))
    assert out["text"] == long
    assert out["notes"][0].startswith("Too long to improve within the 2000-character limit")


def test_improve_that_only_grows_past_the_limit_by_its_goal_line_is_left_alone():
    near = "You are QA. " + "z" * (4000 - len("You are QA. ") - 5)
    out = fa.assist_offline(_req(action="improve", current=near, focus="f" * 300))
    assert len(out["text"]) <= 4000


def test_improve_reports_already_tidy():
    out = fa.assist_offline(_req(field="checklist", node={"type": "gate", "label": "G"}, action="improve",
                                 current="- a\n- b"))
    assert out == {"text": "- a\n- b", "notes": ["Already tidy."]}


LONG_OK = (
    "You are the QA agent. Verify the work against its acceptance criteria and list failures. "
    "Finish with a one-line verdict for the next step."
)


def test_review_returns_no_text_and_looks_complete_when_no_rule_fires():
    out = fa.assist_offline(_req(action="review", current=LONG_OK))
    assert out == {"text": None, "notes": ["Looks complete."]}


@pytest.mark.parametrize(
    "current, field, node_type, expected",
    [
        ("You are QA.", "systemPrompt", "agent", "Too short to guide a model — say what good output looks like."),
        ("x" * 100, "systemPrompt", "skill", "Doesn't say how to finish or what to hand off."),
        ("Verify the work carefully against acceptance criteria and report. " * 2 + "Hand-off: done.", "systemPrompt", "agent",
         "Doesn't state the role."),
        ("- only one item, but it is long enough to pass the short rule " + "y" * 30 + " verdict", "checklist", "gate",
         "A gate checklist needs at least two checkable items."),
        (LONG_OK + " key sk-" + "a" * 30, "systemPrompt", "agent", "Contains something that looks like a secret — remove it."),
    ],
)
def test_each_review_rule_fires_individually(current, field, node_type, expected):
    out = fa.assist_offline(_req(action="review", current=current, field=field, node={"type": node_type, "label": "N"}))
    assert expected in out["notes"]
    assert "Looks complete." not in out["notes"]


def test_review_keeps_at_most_five_notes():
    out = fa.assist_offline(_req(action="review", current="x", field="systemPrompt"))
    assert 1 <= len(out["notes"]) <= 5
