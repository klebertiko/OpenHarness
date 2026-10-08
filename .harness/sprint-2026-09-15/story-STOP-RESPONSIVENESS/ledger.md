# Ledger — STOP-RESPONSIVENESS

Real user report: "cliquei em parar o run e nada aconteceu" (clicked Stop, nothing happened)
during a live harness run. Fixed directly by Sonnet, TDD, no subagent dispatch (small, precisely
diagnosed, backend-only, no overlap with any concurrent agent's active files).

## Root cause (confirmed against current source, not assumed from an earlier diagnosis)

Both `engine.py::execute_harness` and `routers/execution.py::run_direct` drove their adapter's
`stream_events()` with the identical shape:

```python
async for ev in adapter.stream_events(prompt, config):
    if control.stop.is_set():
        break
```

`control.stop.is_set()` is only checked *between* items the adapter has already produced. If the
adapter is blocked waiting to produce its *next* item (a slow local model mid-token, a CLI
subprocess sitting between lines of output — Ollama and the CLI-spawn adapters are exactly this
shape), the check never runs again until the adapter happens to yield on its own. From the user's
seat, Stop does nothing until then, which can be seconds to indefinitely long.

`RunControl`'s own docstring already states the intended design: stop is checked "at the next
checkpoint," deliberately not mid-token, so partial output is never lost. The bug was that "the
next checkpoint" meant "whenever the adapter next produces something," not "the next moment we'd
otherwise sit idle waiting" — those are very different latencies for a slow adapter.

## Fix

Added `RunControl.stream_until_stopped(aiter)` (`engine.py`, next to the existing `park()`, same
file, same class, same race-against-`stop` idiom `park()` already used for the HITL gate wait —
not a new pattern, the same one applied to a second wait point). Races each `__anext__()` call
against `stop.wait()` via `asyncio.wait(..., FIRST_COMPLETED)`; if `stop` wins, cancels the
pending `__anext__()`, awaits it to let the cancellation actually land inside the adapter's
generator (avoids a `RuntimeError` racing `aclose()` against a generator asyncio still considers
mid-resume), then closes it. Still never cancels an item *mid-delivery* — an `__anext__()` that
has already produced a value is allowed to finish delivering it; only the *wait for the next one*
is interruptible.

Both call sites now read:
```python
async for ev in control.stream_until_stopped(adapter.stream_events(prompt, config)):
    kind = ev.get("kind")
    ...
```
(the `if control.stop.is_set(): break` line is gone — the wrapper itself stops yielding once
`stop` wins the race, so the old checkpoint is now redundant, not just weaker).

## TDD evidence

New file `backend/tests/test_engine_stop_responsiveness.py`. `_HangingAdapter` streams one chunk
then blocks forever (`await asyncio.Event().wait()` on an Event that's never set) — the exact
shape of a slow/stuck adapter. Test drives `execute_harness` directly, waits for the first real
`node_stream` chunk (proving the adapter is genuinely mid-stream, not stopped before it started),
sets `control.stop`, then asserts the rest of the generator drains inside `asyncio.wait_for(...,
timeout=1.0)`.

- RED (before the fix): `asyncio.TimeoutError` — reproduced the reported bug exactly; without the
  fix the generator hangs past the 1s timeout waiting on an adapter that will never yield again.
- GREEN (after the fix): passes in 0.36s.

## Verification

- `pytest tests/test_engine_stop_responsiveness.py` — 1/1 passed.
- Full backend suite (`pytest -q`, from `backend/`): **382 passed, 1 failed** — the 1 failure
  (`test_execution_provider_resolution.py::test_direct_history_survives_a_fresh_detail_request`,
  a 404 on `GET /execute/logs/{run_id}` after a direct run) is **not caused by this change** —
  confirmed by temporarily reverting the `routers/execution.py` edit and re-running that single
  test in isolation: it fails identically with the old code too. That test file is untracked
  (`??` in `git status`), part of Codex's in-progress DIRECT-ADAPTER-RESOLVE story
  (`test_execution_provider_resolution.py` is named directly in that story's own ledger) — a
  history/log-persistence gap unrelated to stop-handling. Left untouched; not my scope.
- No frontend changes needed — `useRunStream.ts`'s `requestStop()` already calls the existing
  stop endpoint and reacts to `run_stopped`/`harness_done` the same as before; only the backend's
  responsiveness to an already-correct stop *request* changed.

## Files touched
- `backend/engine.py` (`RunControl.stream_until_stopped` added; harness node loop updated)
- `backend/routers/execution.py` (direct-execution node loop updated, identical call-site change)
- `backend/tests/test_engine_stop_responsiveness.py` (new)
