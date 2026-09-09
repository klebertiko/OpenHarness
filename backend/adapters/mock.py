"""
Mock adapter — no network, no keys, no cost.

It is not a stub that returns a canned string. It replays a *shaped* agent
trace: a thinking phase, a handful of real-looking tool calls with arguments and
results (including one that fails, because a run UI that has never rendered a
failure is a run UI nobody has tested), then streamed prose. The shape is what
the frontend is built against, so swapping in a live provider adapter later is a
matter of emitting the same event kinds — not rewriting the panel.

Content is derived from the incoming prompt where possible, so a run reads as a
response to what was actually asked rather than as lorem ipsum.
"""
import asyncio
import hashlib
import re
from typing import AsyncIterator

from .base import AgentAdapter, AdapterConfig, AdapterResult

# Per-node-type scripts. Each is (reasoning, [tool steps], answer paragraphs).
# A tool step is (name, args, result, ok, ms).
_SCRIPTS: dict[str, dict] = {
    "llm": {
        "reason": (
            "The instruction asks for a change to the run surface, so the first "
            "question is which module owns that surface today. I will read the "
            "entry point before proposing anything."
        ),
        "tools": [
            ("read_file", 'path="src/components/agent-run/AgentRunPanel.tsx"', "342 lines · 11.4 KB", True, 180),
            ("grep", 'pattern="useRunStream\\(" glob="src/**/*.tsx"', "3 matches in 2 files", True, 96),
            ("read_file", 'path="src/components/agent-run/runStore.ts"', "215 lines · 6.9 KB", True, 121),
        ],
        "answer": [
            "The panel already owns its own stream reducer, so the change stays local: "
            "`runStore.ts` is the only writer of transcript state and the components below "
            "it are pure.",
            "I would add the new phase to the reducer's event switch and let the segment "
            "renderer pick it up by name. Nothing upstream of the store needs to know.",
        ],
    },
    "tool": {
        "reason": "Running the check the graph asked for, then reading the exit status.",
        "tools": [
            ("bash", 'cmd="npm run typecheck"', "tsc --noEmit · 0 errors · 4.2s", True, 4210),
            ("bash", 'cmd="npm run lint -- --max-warnings 0"', "eslint: 2 warnings, 0 errors", False, 2640),
        ],
        "answer": [
            "Types are clean. Lint reports two warnings, both `react-hooks/exhaustive-deps` "
            "on intentionally-once effects, so the gate is advisory rather than blocking.",
        ],
    },
    "evaluator": {
        "reason": (
            "Scoring the upstream output against the rubric on the node: correctness "
            "first, then whether it actually answered the instruction."
        ),
        "tools": [
            ("rubric_load", 'name="run-quality/v2"', "5 criteria loaded", True, 40),
        ],
        "answer": [
            "PASS — 8.4 / 10. Correctness 9, instruction-following 9, concision 7.",
            "The one deduction: the answer explains the reducer but never states what "
            "happens to an in-flight stream when the phase changes mid-token.",
        ],
    },
    "memory": {
        "reason": "Retrieving prior context for this harness before the next node needs it.",
        "tools": [
            ("recall", 'k=4 scope="harness"', "4 fragments · 1.2 KB", True, 88),
        ],
        "answer": [
            "Recalled: the panel was last changed to move token accounting out of the "
            "adapter and into the engine, and the HITL gate blocks the whole run rather "
            "than one branch.",
        ],
    },
    "aggregator": {
        "reason": "Merging upstream branches; dropping anything both branches agree on to avoid repeating it.",
        "tools": [],
        "answer": [
            "Both branches converge on the same conclusion, so the merged output keeps the "
            "reasoning from the analysis branch and the verdict from the evaluator branch.",
        ],
    },
}

_DEFAULT_SCRIPT = {
    "reason": "Working through the instruction against the context this node received.",
    "tools": [("read_context", "upstream=1", "ok", True, 60)],
    "answer": ["Produced a response for this node from the upstream context."],
}


def _script_for(config: AdapterConfig) -> dict:
    return _SCRIPTS.get(config.extra.get("node_type", ""), _DEFAULT_SCRIPT)


def _tokens(*parts: str) -> str:
    """Split text into streamable chunks that keep whitespace and punctuation."""
    return re.findall(r"\S+\s*", " ".join(parts))


class MockAdapter(AgentAdapter):
    async def invoke(self, prompt: str, config: AdapterConfig) -> AdapterResult:
        await asyncio.sleep(0.2)
        script = _script_for(config)
        content = "\n\n".join(script["answer"])
        return AdapterResult(
            content=content,
            tokens_used=max(1, len(content) // 4),
            model=config.model or "mock-1",
        )

    async def stream(self, prompt: str, config: AdapterConfig) -> AsyncIterator[str]:
        script = _script_for(config)
        for chunk in _tokens(*script["answer"]):
            await asyncio.sleep(0.02)
            yield chunk

    async def stream_events(
        self, prompt: str, config: AdapterConfig
    ) -> AsyncIterator[dict]:
        script = _script_for(config)
        label = config.extra.get("label", "node")
        # Stable per-node id prefix so tool call ids are reproducible across runs.
        seed = hashlib.sha1(f"{label}:{config.model}".encode()).hexdigest()[:6]

        yield {
            "kind": "phase",
            "phase": "thinking",
            "detail": config.model or "mock-1",
        }
        for chunk in _tokens(script["reason"]):
            await asyncio.sleep(0.014)
            yield {"kind": "reason", "text": chunk}

        for i, (name, args, result, ok, ms) in enumerate(script["tools"]):
            call_id = f"{seed}-{i}"
            yield {"kind": "phase", "phase": "tool", "detail": name}
            yield {"kind": "tool_call", "call_id": call_id, "name": name, "args": args}
            # Compress the simulated wall time; keep the reported duration honest
            # to the script so latency columns have something to sort by.
            await asyncio.sleep(min(ms, 900) / 1000 * 0.45)
            yield {
                "kind": "tool_result",
                "call_id": call_id,
                "ok": ok,
                "result": result,
                "duration_ms": ms,
            }

        yield {"kind": "phase", "phase": "writing", "detail": config.model or "mock-1"}
        answer = list(script["answer"])
        # Echo the operator's own words back once, so the run visibly responds to
        # the instruction that started it rather than ignoring it.
        head = prompt.strip().splitlines()[0][:120] if prompt.strip() else ""
        if head and config.extra.get("node_type") == "llm":
            answer = [f"On “{head}” — {answer[0][0].lower()}{answer[0][1:]}", *answer[1:]]

        text = "\n\n".join(answer)
        for chunk in _tokens(text):
            await asyncio.sleep(0.022)
            yield {"kind": "text", "text": chunk}

        yield {"kind": "usage", "tokens": max(1, len(text) // 4) + 128}
