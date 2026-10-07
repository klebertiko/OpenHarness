"""Studio-side secret redaction: sandbox patterns plus the key shapes they miss (QA wave 1, L2)."""
from __future__ import annotations

import pytest

from studio_copilot import field_assist as fa
from studio_copilot import redaction

KEYS = {
    "anthropic": "sk-ant-api03-" + "A1b2C3d4" * 6,
    "openai_project": "sk-proj-" + "x9Y8z7" * 8,
    "google": "AIzaSy" + "q" * 33,
    "openai": "sk-" + "a" * 30,
}


@pytest.mark.parametrize("name", list(KEYS))
def test_every_known_key_shape_is_redacted(name):
    text, count = redaction.redact(f"use {KEYS[name]} here")
    assert KEYS[name] not in text
    assert count == 1
    assert text.startswith("use [redacted:") and text.endswith("] here")


def test_clean_text_is_untouched():
    assert redaction.redact("You are QA. Check tests.") == ("You are QA. Check tests.", 0)


def test_counts_every_hit():
    _, count = redaction.redact(f"{KEYS['anthropic']} and {KEYS['google']} and {KEYS['openai']}")
    assert count == 3


@pytest.mark.parametrize("name", list(KEYS))
def test_field_assist_review_flags_every_known_key_shape(name):
    req = fa.AssistRequest.model_validate({
        "field": "systemPrompt", "action": "review", "node": {"type": "agent", "label": "A"},
        "current": "You are the QA agent. Verify the work against its acceptance criteria. Finish with a verdict. " + KEYS[name],
        "mode": "mock",
    })
    assert "Contains something that looks like a secret — remove it." in fa.assist_offline(req)["notes"]
