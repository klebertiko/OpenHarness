# DIRECT-ADAPTER-RESOLVE — Direct chat must reach the real connection, never silently MockAdapter

Status: Sprint-Ready, pending HITL Sprint-Goal confirmation. Planning estimate: 5 points. Priority: P1 High.

Authority: user report while investigating the unrelated, separately-tracked PROVIDER-VERIFY-BUDGET story
(composer-chip "Not verified" display). Confirmed independently against current source below — do not
conflate the two stories or their branches/worktrees.

## Confirmed root cause (verified against current code, 2026-09-15)

With the harness toggle OFF ("Direct" chat), `AgentStage.tsx`'s `onStart()` calls `start({ ..., providerId:
provider.id })` (`provider.id` is a real connection id — see `chatProvider.ts`'s `ChatProvider.id` doc
comment). `useRunStream.ts`'s `start()` captures that into `providerIdRef` (used only for post-hoc outcome
crediting) but its `startDirectRun()` call — [useRunStream.ts:146-150](../../../frontend/src/components/agent-run/useRunStream.ts) —
forwards only `{ instruction, mode, step, cwd }`. `DirectRunPayload`
([runClient.ts:85-92](../../../frontend/src/components/agent-run/runClient.ts)) supports `adapter`/`model`,
but nothing ever fills them.

Server-side, `run_direct()` — [execution.py:398](../../../backend/routers/execution.py) — computes:
```python
adapter_name = "mock" if body.mode == "mock" else (body.adapter or "mock")
```
`body.mode` is always `"live"` or `"local"` from the real app (`chatProvider.ts`'s `modeOf()` never
produces `"mock"`), and `body.adapter` is always `None` since the frontend never sends it — so every
real Direct-mode chat silently resolves to `"mock"` regardless of which connection the chip shows selected.
This directly contradicts `AgentStage.tsx`'s own comment: "Chat is never mock: it runs against the connected
provider."

This goes unnoticed because `useHarnessSessionStore.enabled` defaults to `true`
([harnessSessionStore.ts:59](../../../frontend/src/store/harnessSessionStore.ts)), so most chats take the
harness-on `POST /execute/` path, which resolves a real connection through
`resolve_node_provider()` ([resolution.py](../../../backend/providers/resolution.py)). `run_direct()` has no
equivalent lookup at all today — it doesn't even take `request: Request`, so it can't reach
`request.app.state.provider_connections` / `.secrets_store` the way `run_harness()` does.

## Why direction 2 (backend-owned resolution) is recommended over direction 1 (frontend sends adapter name)

Two fix directions were proposed. Investigation surfaced two concrete reasons to prefer backend-owned
resolution, both grounded in what the codebase already does and says:

1. **`resolve_node_provider()`'s own docstring states the house rule**: "Every one of these raises
   `ProviderResolutionError` instead of resolving to MockAdapter — a run must never swap in mock output
   silently." It also states the harness path's precedence rule explicitly: the frontend supplies a
   **connection id**, and "the backend never re-derives a chip fallback of its own — one id, one place that
   decided it." A frontend-computed `adapter` string for Direct mode would mean the *client* asserts which
   adapter runs, unvalidated against whether that connection is actually enabled/credentialed/chat-capable —
   a real regression from the harness path's existing trust boundary, not just a style mismatch.
2. **Direction 1 is functionally incomplete for HTTP-based connections.** `run_direct()`'s `AdapterConfig`
   today carries no `endpoint`/`api_key` at all (only `adapter`, `model`, `extra`). `resolve_node_provider()`
   requires both for Ollama/OpenRouter/OpenAI-compatible connections (`_HTTP_ADAPTERS_REQUIRE_MODEL`) and
   pulls `api_key` from the secrets vault via `connection.secretRef`. Sending just an adapter *name* from the
   frontend would leave Direct-mode HTTP connections with no credential and no endpoint — likely appearing
   to "work" only for CLI-backed connections (claude/codex, which may authenticate via ambient CLI login)
   while silently breaking or mis-behaving for Ollama/OpenRouter. Fixing this properly requires the same
   connection → credential → `AdapterConfig` resolution `resolve_node_provider()` already does.

**Recommendation for BE: reuse or directly parallel `resolve_node_provider()`, keyed off a connection id the
frontend already has (`provider.id`) and already threads as far as `providerIdRef` — it just needs to reach
the wire.** ARCH's Stage-1 review should confirm this against pattern/ADR compliance; this is a strong
recommendation from investigation, not a unilateral PO implementation mandate.

**Constraint BE must reconcile, not break:** `tests/test_execution_cwd.py` (lines ~207, 219) and
`tests/test_execution_budget_enforcement.py` (lines ~115, 131, 137) already `POST /execute/direct` with an
explicit `"adapter": "claude"` body field and monkeypatch `routers.execution.get_adapter` directly, to test
cwd validation and budget enforcement in isolation from provider resolution. These must keep passing — either
the raw `adapter` field stays supported as a lower-level/back-compat path, or these two files get updated
deliberately (not as accidental breakage) to exercise the new connection-id path instead.

## Acceptance Criteria

1. With the harness toggle OFF and a real, enabled, connected provider selected (not "no provider
   available"), sending a chat message causes `POST /execute/direct`'s resolved adapter to be the real
   adapter for that connection's provider (e.g. `"claude"` for an Anthropic connection) — never `"mock"` —
   and the reply is genuine adapter output, not canned mock text.
2. This holds for every provider currently in `ADAPTER_BY_PROVIDER` (anthropic→claude, openai→codex,
   ollama→ollama, openrouter→openrouter), including HTTP-based connections that require a resolved
   `endpoint`, `api_key`, and `model` to function — not only CLI-backed ones.
3. If the selected connection is disabled, unrecognized, missing its credential, or doesn't support chat,
   Direct mode surfaces an honest, actionable error (mirroring `ProviderResolutionError`'s messages) —
   it must never silently substitute MockAdapter output instead.
4. Explicit mock mode (`mode === "mock"`, Studio's own authoring/testing path) is unchanged — still always
   resolves to MockAdapter regardless of any connection.
5. Harness-ON chats (`POST /execute/`, `resolve_node_provider()`) are unaffected — this story only touches
   the harness-off Direct path.
6. `useRunStream.ts`'s outcome-crediting effect (a completed non-mock segment moves `useProviderStore`
   health toward verified) continues to work for the Direct path with whatever payload shape results.

## Testing seams
- AC#1, #2, #3 → `AgentStage`'s `onStart()` → captured `startDirectRun()` call (mock pattern already in
  `AgentStage.composition.test.tsx`) → component test asserting the outgoing payload identifies the real
  selected connection, not an absent/mock adapter.
- AC#1, #2, #3 → `POST /execute/direct` handler (`run_direct()` in `backend/routers/execution.py`) → new
  pytest coverage with a fake `connections`/`secrets_store` fixture (pattern in
  `tests/test_provider_resolution.py` / `tests/test_execution_provider_resolution.py`), covering: enabled
  + credentialed connection → real adapter resolved; disabled connection → honest error, no mock fallback;
  unknown connection id → honest error; missing credential → honest error; non-chat-capable provider →
  honest error.
- AC#4 → same `run_direct()` tests, `mode: "mock"` branch, asserting no change.
- AC#5 → existing harness-path tests (`test_execution_provider_resolution.py`, `test_provider_resolution.py`)
  stay green untouched.
- AC#6 → existing `useRunStream` / outcome-crediting tests stay green; extend if the payload shape changes.
- Regression floor (confirmed 2026-09-15, before this story): frontend `npm run test` → **254 passed, 57
  files**; backend `.venv/Scripts/python.exe -m pytest -q` → **321 passed**. Both must stay fully green.

## Definition of Done
- [ ] TDD: RED confirmed (frontend seam and backend seam separately) before implementation, then GREEN,
      recorded in `ledger.md` per AC slice.
- [ ] Full frontend regression green (`npm run test`) and `npm run typecheck` clean.
- [ ] Full backend regression green (`.venv/Scripts/python.exe -m pytest -q` from `backend/`).
- [ ] `tests/test_execution_cwd.py` and `tests/test_execution_budget_enforcement.py` reconciled deliberately
      (documented in ledger), not broken as collateral damage.
- [ ] No behavior change to `mode === "mock"` or to the harness-on `POST /execute/` path.
- [ ] Fresh QA gate against these AC.
- [ ] Fresh SEC gate — this touches which credential/connection actually serves a chat turn; explicitly
      review that Direct mode cannot be made to use a connection the caller doesn't legitimately have
      selected, and that error messages don't leak credential material.
- [ ] ARCH Stage-1 review, specifically confirming the resolution approach properly parallels/reuses
      `resolve_node_provider()` rather than duplicating its logic divergently.
- [ ] HITL merge only — no auto-merge, no destructive git operations without explicit confirmation (shared,
      uncommitted checkout).
- [ ] External handoff written under `D:/Development/handoffs/` documenting the fix, the direction taken and
      why, and final test counts — following this project's existing handoff convention.

## Ownership
BE: `backend/routers/execution.py` (`DirectRequest`, `run_direct()`), `backend/providers/resolution.py` (new
shared/parallel resolver if reuse isn't a clean fit), new/updated backend tests. FE: `frontend/src/components/
agent-run/useRunStream.ts` (`start()` → `startDirectRun` call), `frontend/src/components/agent-run/
runClient.ts` (`DirectRunPayload`), `AgentStage.tsx` only if the call site needs a field rename, and
`AgentStage.composition.test.tsx`. Wire contract (FE and BE must agree before parallel work starts): add a
connection-id field to `DirectRunPayload`/`DirectRequest` — reusing the existing `providerId` naming already
used by `useRunStream.start()`'s parameter and the harness path's `providerIds` convention is preferred over
inventing new vocabulary, but this is BE/FE's call to finalize together, ARCH to confirm.

Stop-the-Line: PASS — explicit AC, DoD, seams and points recorded; root cause independently verified against
current source, not just the reporter's original file:line references (some had drifted from concurrent
PROVIDER-VERIFY-BUDGET work but the underlying bug is confirmed unchanged).
