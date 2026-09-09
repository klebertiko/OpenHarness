"""
Harness execution engine.

Topologically sorts a node graph, walks it, and streams SSE events describing
everything the run does — not just the text it produced.

The event vocabulary is deliberately wider than "tokens arrived". A harness run
is a traversal of a graph the user drew, so the stream carries the *plan* up
front (`run_start.order`), then per-node phase transitions, tool calls with
their results, human-in-the-loop gates that actually block, and a terminal
verdict. A client that renders only `node_stream` still works; a client that
renders the whole vocabulary can show a person exactly where their graph is.

Control flow (stop / step / HITL resolution / mid-run steering) arrives out of
band through a `RunControl` handle registered in `RUNS`, which the HTTP router
looks up by run id. The generator is the only writer of stream events; the
router only ever sets events and drops payloads into the control object.
"""
import asyncio
import json
import time
import uuid
from collections import defaultdict, deque
from typing import Any, AsyncIterator, Callable

from adapters import get_adapter, AdapterConfig
from runtime.router import select_runtime

# ── Terminal states a run can land in ──────────────────────────────────────────
STATUS_COMPLETE = "complete"
STATUS_STOPPED = "stopped"
STATUS_ERROR = "error"


class RunControl:
    """
    Out-of-band handle on an in-flight run.

    `gate` is a single-shot latch the engine waits on whenever it is parked —
    either between nodes in step mode, or at a HITL node. The router sets it;
    the engine clears it after waking. `stop` is sticky: once set the run
    unwinds at the next checkpoint rather than being cancelled mid-token, so
    partial output is never lost.
    """

    def __init__(self, run_id: str, step: bool = False):
        self.run_id = run_id
        self.step = step
        self.stop = asyncio.Event()
        self.gate = asyncio.Event()
        self.decision: dict | None = None
        self.inbox: list[str] = []
        self.phase: str = "starting"
        self.started_at = time.time()

    def release(self) -> None:
        self.gate.set()

    async def park(self) -> bool:
        """Block until released or stopped. Returns False if the run was stopped."""
        stopper = asyncio.create_task(self.stop.wait())
        opener = asyncio.create_task(self.gate.wait())
        done, pending = await asyncio.wait(
            {stopper, opener}, return_when=asyncio.FIRST_COMPLETED
        )
        for task in pending:
            task.cancel()
        self.gate.clear()
        return not self.stop.is_set()

    def drain_inbox(self) -> list[str]:
        msgs, self.inbox = self.inbox, []
        return msgs


# Live runs, keyed by run id. Entries are removed by the router once the
# stream generator finishes, so a stale id can never be steered.
RUNS: dict[str, RunControl] = {}


def topological_sort(nodes: list[dict], edges: list[dict]) -> tuple[list[str], list[str]]:
    """
    Kahn's algorithm. Returns (execution order, unreachable node ids).

    The second element matters: the original implementation silently dropped
    every node inside a cycle, so a harness with an accidental loop appeared to
    run fine while skipping half the graph. Now the caller can say so out loud.
    """
    graph: dict[str, list[str]] = defaultdict(list)
    in_degree: dict[str, int] = {n["id"]: 0 for n in nodes}

    for edge in edges:
        if edge["source"] not in in_degree or edge["target"] not in in_degree:
            continue
        graph[edge["source"]].append(edge["target"])
        in_degree[edge["target"]] += 1

    queue = deque(nid for nid, deg in in_degree.items() if deg == 0)
    order: list[str] = []
    while queue:
        nid = queue.popleft()
        order.append(nid)
        for neighbor in graph[nid]:
            in_degree[neighbor] -= 1
            if in_degree[neighbor] == 0:
                queue.append(neighbor)

    unreachable = [nid for nid in in_degree if nid not in set(order)]
    return order, unreachable


def _sse(event: str, data: Any) -> str:
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"


# Node types the engine resolves itself, with no adapter round-trip.
_INTRINSIC = {"input", "output", "router", "hitl"}


def _node_view(node: dict) -> dict:
    data = node.get("data", {})
    node_type = node.get("type", "llm")
    return {
        "node_id": node["id"],
        "type": node_type,
        "label": data.get("label") or node_type,
        "adapter": data.get("adapter", "mock"),
        "model": data.get("model", ""),
        "intrinsic": node_type in _INTRINSIC,
    }


async def execute_harness(
    harness_json: dict,
    execution_mode: str = "mock",
    control: RunControl | None = None,
    run_id: str = "",
    user_pref: str | None = None,
    probe: Callable[[str], str | None] | None = None,
) -> AsyncIterator[str]:
    """
    Stream of SSE events:

      run_start         {run_id, mode, order:[node_view], unreachable}
      runtime_selected  {kind, name, reason}         — CLI probe or API fallback
      awaiting_step     {next: node_view}            — parked, step mode
      node_start        {node_id, label, type, adapter, model}
      node_phase        {node_id, phase, detail}     — thinking|tool|writing|done
      node_reason       {node_id, chunk}             — reasoning text
      node_stream       {node_id, chunk}             — answer text
      tool_call         {node_id, call_id, name, args}
      tool_result       {node_id, call_id, ok, result, duration_ms}
      node_done         {node_id, output, tokens, latency_ms}
      node_error        {node_id, error}
      hitl_pause        {node_id, label, question, context}
      hitl_resolved     {node_id, decision, note}
      user_message      {text}                       — steering injected mid-run
      run_stopped       {at_node}
      harness_done      {status, total_tokens, elapsed_ms, nodes_run}
    """
    nodes: list[dict] = harness_json.get("nodes", [])
    edges: list[dict] = harness_json.get("edges", [])
    if not nodes and isinstance(harness_json.get("graph"), dict):
        nodes = harness_json["graph"].get("nodes", [])
        edges = harness_json["graph"].get("edges", [])
    control = control or RunControl(run_id or str(uuid.uuid4()))

    node_map = {n["id"]: n for n in nodes}
    outputs: dict[str, str] = {}
    steering: list[str] = []
    total_tokens = 0
    nodes_run = 0
    harness_start = time.time()

    order, unreachable = topological_sort(nodes, edges)

    yield _sse(
        "run_start",
        {
            "run_id": control.run_id,
            "mode": execution_mode,
            "step": control.step,
            "order": [_node_view(node_map[nid]) for nid in order if nid in node_map],
            "unreachable": unreachable,
        },
    )

    bundle_runtime = harness_json.get("runtime")
    choice = select_runtime(bundle_runtime, user_pref, probe=probe)
    yield _sse(
        "runtime_selected",
        {"kind": choice.kind, "name": choice.name, "reason": choice.reason},
    )

    status = STATUS_COMPLETE
    stopped_at: str | None = None

    for index, node_id in enumerate(order):
        node = node_map.get(node_id)
        if not node:
            continue

        if control.stop.is_set():
            status, stopped_at = STATUS_STOPPED, node_id
            break

        # Step mode parks *before* each node so a person can read the previous
        # node's output before the next one starts spending tokens.
        if control.step and index > 0:
            control.phase = "awaiting_step"
            yield _sse("awaiting_step", {"next": _node_view(node)})
            if not await control.park():
                status, stopped_at = STATUS_STOPPED, node_id
                break

        for msg in control.drain_inbox():
            steering.append(msg)
            yield _sse("user_message", {"text": msg, "at_node": node_id})

        node_type: str = node.get("type", "llm")
        data: dict = node.get("data", {})
        label = data.get("label") or node_type
        upstream_ids = [e["source"] for e in edges if e["target"] == node_id]

        # ── Intrinsic nodes — resolved by the engine, no adapter ───────────────
        if node_type == "input":
            text = data.get("prompt", "")
            if steering:
                text = "\n\n".join([text, *steering]).strip()
            outputs[node_id] = text
            yield _sse("node_start", {**_node_view(node)})
            yield _sse(
                "node_done",
                {"node_id": node_id, "output": text, "tokens": 0, "latency_ms": 0},
            )
            nodes_run += 1
            continue

        if node_type == "output":
            final = "\n\n".join(
                outputs.get(uid, "") for uid in upstream_ids if outputs.get(uid)
            )
            outputs[node_id] = final
            yield _sse("node_start", {**_node_view(node)})
            yield _sse(
                "node_done",
                {"node_id": node_id, "output": final, "tokens": 0, "latency_ms": 0},
            )
            nodes_run += 1
            continue

        if node_type == "router":
            chosen_id = upstream_ids[0] if upstream_ids else None
            chosen = outputs.get(chosen_id, "") if chosen_id else ""
            outputs[node_id] = chosen
            yield _sse("node_start", {**_node_view(node)})
            yield _sse(
                "node_phase",
                {
                    "node_id": node_id,
                    "phase": "routing",
                    "detail": data.get("condition", "first upstream branch"),
                },
            )
            yield _sse(
                "node_done",
                {"node_id": node_id, "output": chosen, "tokens": 0, "latency_ms": 0},
            )
            nodes_run += 1
            continue

        if node_type == "hitl":
            context = "\n\n".join(
                outputs.get(uid, "") for uid in upstream_ids if outputs.get(uid)
            )
            yield _sse("node_start", {**_node_view(node)})
            control.phase = "awaiting_human"
            control.decision = None
            yield _sse(
                "hitl_pause",
                {
                    "node_id": node_id,
                    "label": label,
                    "question": data.get("approvalLabel")
                    or "Approve this step and continue the run?",
                    "context": context,
                },
            )
            if not await control.park():
                status, stopped_at = STATUS_STOPPED, node_id
                break

            decision = (control.decision or {}).get("decision", "approve")
            note = (control.decision or {}).get("note", "")
            yield _sse(
                "hitl_resolved",
                {"node_id": node_id, "decision": decision, "note": note},
            )
            if decision == "reject":
                outputs[node_id] = ""
                yield _sse(
                    "node_error",
                    {"node_id": node_id, "error": note or "Rejected by reviewer."},
                )
                status, stopped_at = STATUS_STOPPED, node_id
                break

            merged = context if not note else f"{context}\n\nReviewer note: {note}"
            outputs[node_id] = merged
            yield _sse(
                "node_done",
                {"node_id": node_id, "output": merged, "tokens": 0, "latency_ms": 0},
            )
            nodes_run += 1
            continue

        # ── Adapter-backed nodes ──────────────────────────────────────────────
        prompt_parts = [outputs.get(uid, "") for uid in upstream_ids if outputs.get(uid)]
        prompt = "\n\n".join(prompt_parts) or data.get("prompt", "")

        adapter_name = "mock" if execution_mode == "mock" else data.get("adapter", "mock")
        adapter = get_adapter(adapter_name)
        config = AdapterConfig(
            adapter=adapter_name,
            model=data.get("model", ""),
            endpoint=data.get("endpoint", ""),
            api_key=data.get("apiKey", ""),
            system_prompt=data.get("systemPrompt", ""),
            temperature=float(data.get("temperature", 0.7)),
            max_tokens=int(data.get("maxTokens", 4096)),
            extra={"node_type": node_type, "label": label},
        )

        yield _sse("node_start", {**_node_view(node)})
        node_start = time.time()
        collected: list[str] = []
        node_tokens = 0

        try:
            async for ev in adapter.stream_events(prompt, config):
                if control.stop.is_set():
                    break
                kind = ev.get("kind")
                if kind == "phase":
                    control.phase = ev.get("phase", "")
                    yield _sse(
                        "node_phase",
                        {
                            "node_id": node_id,
                            "phase": ev.get("phase", ""),
                            "detail": ev.get("detail", ""),
                        },
                    )
                elif kind == "reason":
                    yield _sse("node_reason", {"node_id": node_id, "chunk": ev.get("text", "")})
                elif kind == "text":
                    collected.append(ev.get("text", ""))
                    yield _sse("node_stream", {"node_id": node_id, "chunk": ev.get("text", "")})
                elif kind == "tool_call":
                    yield _sse(
                        "tool_call",
                        {
                            "node_id": node_id,
                            "call_id": ev.get("call_id", ""),
                            "name": ev.get("name", ""),
                            "args": ev.get("args", ""),
                        },
                    )
                elif kind == "tool_result":
                    yield _sse(
                        "tool_result",
                        {
                            "node_id": node_id,
                            "call_id": ev.get("call_id", ""),
                            "ok": ev.get("ok", True),
                            "result": ev.get("result", ""),
                            "duration_ms": ev.get("duration_ms", 0),
                        },
                    )
                elif kind == "usage":
                    node_tokens = int(ev.get("tokens", 0))

            output = "".join(collected)
            outputs[node_id] = output
            latency = int((time.time() - node_start) * 1000)

            # Adapters that never reported usage get a single cheap estimate
            # rather than the old behaviour, which reported 0 tokens for every
            # streamed node because `invoke` was only called when nothing
            # streamed at all.
            if not node_tokens:
                node_tokens = max(1, len(output) // 4)
            total_tokens += node_tokens
            nodes_run += 1

            yield _sse(
                "node_done",
                {
                    "node_id": node_id,
                    "output": output,
                    "tokens": node_tokens,
                    "latency_ms": latency,
                },
            )

        except Exception as exc:  # noqa: BLE001 — surfaced to the client verbatim
            outputs[node_id] = ""
            status = STATUS_ERROR
            yield _sse("node_error", {"node_id": node_id, "error": str(exc)})

        if control.stop.is_set():
            status, stopped_at = STATUS_STOPPED, node_id
            break

    if status == STATUS_STOPPED:
        yield _sse("run_stopped", {"at_node": stopped_at})

    control.phase = "done"
    elapsed = int((time.time() - harness_start) * 1000)
    yield _sse(
        "harness_done",
        {
            "status": status,
            "total_tokens": total_tokens,
            "elapsed_ms": elapsed,
            "nodes_run": nodes_run,
        },
    )
