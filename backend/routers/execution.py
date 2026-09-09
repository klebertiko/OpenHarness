import asyncio
import json
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from database import SessionLocal, get_db
from models import Harness, ExecutionLog
from adapters import get_adapter, AdapterConfig
from engine import RUNS, RunControl, STATUS_COMPLETE, STATUS_ERROR, STATUS_STOPPED, _sse, execute_harness

router = APIRouter(prefix="/execute", tags=["execution"])


class ExecuteRequest(BaseModel):
    harness_id: str | None = None
    graph_json: dict | None = None
    mode: str = "mock"  # mock | live | local
    step: bool = False
    instruction: str | None = None


class DirectRequest(BaseModel):
    """One adapter turn — no harness graph. Same SSE vocabulary as /execute/."""

    instruction: str
    mode: str = "mock"  # mock | live | local
    adapter: str | None = None
    model: str | None = None
    step: bool = False


class ControlRequest(BaseModel):
    action: str  # stop | step | resume
    decision: str | None = None  # approve | reject  (hitl only)
    note: str | None = None
    text: str | None = None  # message (steering) only


def _apply_instruction(graph: dict, instruction: str | None) -> dict:
    """
    Seed the run with the operator's instruction.

    A harness usually starts at an `input` node holding a stored prompt. When a
    person types into the composer they are replacing that prompt for this run
    only, so the graph is copied rather than mutated — the saved harness on disk
    must not silently change because someone pressed Enter.
    """
    if not instruction:
        return graph
    nodes = []
    seeded = False
    for node in graph.get("nodes", []):
        if node.get("type") == "input" and not seeded:
            data = {**node.get("data", {}), "prompt": instruction}
            nodes.append({**node, "data": data})
            seeded = True
        else:
            nodes.append(node)
    return {**graph, "nodes": nodes}


@router.post("/")
async def run_harness(body: ExecuteRequest, db: AsyncSession = Depends(get_db)):
    if body.harness_id:
        h = await db.get(Harness, body.harness_id)
        if not h:
            raise HTTPException(404, "Harness not found")
        graph = json.loads(h.graph_json)
        name = h.name
    elif body.graph_json:
        graph = body.graph_json
        name = "Ad-hoc execution"
    else:
        raise HTTPException(400, "Provide harness_id or graph_json")

    graph = _apply_instruction(graph, body.instruction)

    run_id = str(uuid.uuid4())
    log = ExecutionLog(
        id=run_id,
        harness_id=body.harness_id or "adhoc",
        harness_name=name,
        status="running",
    )
    db.add(log)
    await db.commit()

    control = RunControl(run_id, step=body.step)
    RUNS[run_id] = control

    async def event_stream():
        status = "error"
        chunks = 0
        try:
            async for chunk in execute_harness(
                graph, execution_mode=body.mode, control=control, run_id=run_id
            ):
                chunks += 1
                if chunk.startswith("event: harness_done"):
                    try:
                        payload = json.loads(chunk.split("data: ", 1)[1].strip())
                        status = payload.get("status", "complete")
                    except (IndexError, ValueError):
                        status = "complete"
                yield chunk
        except asyncio.CancelledError:
            # The client hung up. Unwind the run rather than leaking a control
            # handle that nothing will ever release.
            control.stop.set()
            status = "stopped"
            raise
        except Exception as exc:  # noqa: BLE001
            yield f"event: error\ndata: {json.dumps({'error': str(exc)})}\n\n"
        finally:
            RUNS.pop(run_id, None)
            # A fresh session: the request-scoped one is torn down by its
            # dependency and cannot be relied on inside a streaming generator.
            async with SessionLocal() as session:
                finished = await session.get(ExecutionLog, run_id)
                if finished:
                    finished.status = status
                    finished.result_json = json.dumps({"events": chunks})
                    finished.finished_at = datetime.now(timezone.utc).replace(tzinfo=None)
                    await session.commit()

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
            "X-Execution-Id": run_id,
        },
    )


@router.post("/direct")
async def run_direct(body: DirectRequest):
    """
    Thin passthrough: one synthetic llm node, one adapter turn, no graph walk.

    Exists so Agent mode can run with harness disabled while still speaking the
    same SSE dialect the agent-run panel already understands (including stop
    via /execute/{run_id}/control).
    """
    import time

    prompt = (body.instruction or "").strip()
    if not prompt:
        raise HTTPException(400, "instruction is required")

    run_id = str(uuid.uuid4())
    control = RunControl(run_id, step=body.step)
    RUNS[run_id] = control

    node_id = "direct"
    adapter_name = "mock" if body.mode == "mock" else (body.adapter or "mock")
    model = body.model or ("mock-1" if adapter_name == "mock" else "")
    node_view = {
        "node_id": node_id,
        "type": "llm",
        "label": "Direct",
        "adapter": adapter_name,
        "model": model,
        "intrinsic": False,
    }

    async def event_stream():
        status = STATUS_COMPLETE
        total_tokens = 0
        nodes_run = 0
        started = time.time()
        try:
            yield _sse(
                "run_start",
                {
                    "run_id": run_id,
                    "mode": body.mode,
                    "step": body.step,
                    "order": [node_view],
                    "unreachable": [],
                },
            )

            if control.stop.is_set():
                status = STATUS_STOPPED
                yield _sse("run_stopped", {"at_node": node_id})
            else:
                adapter = get_adapter(adapter_name)
                config = AdapterConfig(
                    adapter=adapter_name,
                    model=model,
                    extra={"node_type": "llm", "label": "Direct"},
                )
                yield _sse("node_start", node_view)
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
                            yield _sse(
                                "node_reason",
                                {"node_id": node_id, "chunk": ev.get("text", "")},
                            )
                        elif kind == "text":
                            collected.append(ev.get("text", ""))
                            yield _sse(
                                "node_stream",
                                {"node_id": node_id, "chunk": ev.get("text", "")},
                            )
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
                    if not node_tokens:
                        node_tokens = max(1, len(output) // 4)
                    total_tokens = node_tokens
                    nodes_run = 1 if not control.stop.is_set() else 0
                    latency = int((time.time() - node_start) * 1000)

                    if control.stop.is_set():
                        status = STATUS_STOPPED
                        yield _sse(
                            "node_done",
                            {
                                "node_id": node_id,
                                "output": output,
                                "tokens": node_tokens,
                                "latency_ms": latency,
                            },
                        )
                        yield _sse("run_stopped", {"at_node": node_id})
                    else:
                        yield _sse(
                            "node_done",
                            {
                                "node_id": node_id,
                                "output": output,
                                "tokens": node_tokens,
                                "latency_ms": latency,
                            },
                        )
                except Exception as exc:  # noqa: BLE001
                    status = STATUS_ERROR
                    yield _sse("node_error", {"node_id": node_id, "error": str(exc)})

            control.phase = "done"
            yield _sse(
                "harness_done",
                {
                    "status": status,
                    "total_tokens": total_tokens,
                    "elapsed_ms": int((time.time() - started) * 1000),
                    "nodes_run": nodes_run,
                },
            )
        except asyncio.CancelledError:
            control.stop.set()
            raise
        except Exception as exc:  # noqa: BLE001
            yield _sse("error", {"error": str(exc)})
        finally:
            RUNS.pop(run_id, None)

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
            "X-Execution-Id": run_id,
        },
    )


@router.post("/{run_id}/control")
async def control_run(run_id: str, body: ControlRequest):
    """
    Out-of-band control for an in-flight run.

    Kept separate from the SSE response on purpose: the stream is one-way and
    long-lived, and a control action must be able to land (and be acknowledged
    with a real status code) even while the engine is mid-token.
    """
    control = RUNS.get(run_id)
    if not control:
        raise HTTPException(404, "Run is not active")

    action = body.action
    if action == "stop":
        control.stop.set()
        control.release()
    elif action in ("step", "resume"):
        if body.decision:
            control.decision = {"decision": body.decision, "note": body.note or ""}
        control.release()
    elif action == "message":
        if body.text:
            control.inbox.append(body.text)
    else:
        raise HTTPException(400, f"Unknown action: {action}")

    return {"ok": True, "run_id": run_id, "action": action}


@router.get("/active")
async def active_runs():
    return [
        {"run_id": rid, "phase": c.phase, "step": c.step}
        for rid, c in RUNS.items()
    ]


@router.get("/logs")
async def list_logs(db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(ExecutionLog).order_by(ExecutionLog.started_at.desc()).limit(50)
    )
    logs = result.scalars().all()
    return [
        {
            "id": lg.id,
            "harness_id": lg.harness_id,
            "harness_name": lg.harness_name,
            "status": lg.status,
            "started_at": lg.started_at.isoformat() if lg.started_at else None,
            "finished_at": lg.finished_at.isoformat() if lg.finished_at else None,
        }
        for lg in logs
    ]
