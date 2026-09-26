"""Non-authoritative Laya issue triage experiment.

The output is evidence only. It must never decide CI, severity, release eligibility,
or mutate a GitHub issue.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from time import perf_counter

from laya import Router


def main() -> None:
    event = json.loads(Path(os.environ["GITHUB_EVENT_PATH"]).read_text(encoding="utf-8"))
    issue = event["issue"]
    state = {
        "title": issue.get("title", "")[:500],
        "body": issue.get("body", "")[:6000],
    }
    questions = {
        "component": {
            "type": "choice",
            "instructions": "Which OpenHarness component most likely owns this issue?",
            "criteria": {
                "backend": "Python API, execution engine, adapters, storage or scheduler",
                "frontend": "Next.js interface, state, components or accessibility",
                "desktop": "Tauri, Rust, Windows installer or sidecar packaging",
                "ci_security": "CI, release, dependencies, supply chain or security tooling",
                "documentation": "Documentation, examples or contributor experience",
                "unknown": "Insufficient information or cross-cutting concern",
            },
        },
        "kind": {
            "type": "choice",
            "instructions": "What kind of work does this issue primarily describe?",
            "criteria": {
                "bug": "Existing behavior is incorrect or broken",
                "feature": "New user-visible capability",
                "security": "Vulnerability, hardening or trust boundary concern",
                "maintenance": "Dependencies, refactoring, CI or operational upkeep",
                "question": "Clarification or support request",
                "unknown": "Insufficient information",
            },
        },
        "needs_human_triage": {
            "type": "noul",
            "instructions": "Is the issue ambiguous, cross-cutting, or high impact enough to require human triage?",
        },
    }
    started = perf_counter()
    result = Router(max_loaded=1).predict(state, questions)
    evidence = {
        "schema_version": "openharness-issue-triage-v1",
        "authority": "advisory-shadow",
        "issue_number": issue["number"],
        "model_result": result,
        "latency_ms": round((perf_counter() - started) * 1000, 2),
    }
    output = Path(os.environ.get("LAYA_OUTPUT", "laya-shadow-result.json"))
    output.write_text(json.dumps(evidence, ensure_ascii=False, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
