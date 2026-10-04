# Ledger — PROVIDER-VERIFY-BUDGET (FE bounce-fix pass, Story 2)

Date: 2026-09-15. FE, fresh work picking up the QA bounce recorded in `qa.md`. Story 1
(provider status truth) passed clean — not touched, not reviewed, no files under its
scope opened for edit. Everything below is Story 2 (token/cost/budget) only, addressing
exactly QA's two findings.

**Status: Ready for QA re-pass.** Both findings fixed, TDD RED→GREEN, both pinned by new
tests, full frontend suite green, typecheck clean.

---

## Finding 1 — Dossier.tsx's unpriced caveat contradicted the "free" label

**File:** `frontend/src/components/providers/Dossier.tsx:232`

**RED:** Added `frontend/src/components/providers/Dossier.test.tsx` (did not exist before
— QA noted this was exactly why nothing caught it). Two cases:
- a local Ollama connection with real, fully-unpriced usage must show "free" and must NOT
  show the "may understate real spend" caveat.
- a cloud connection with genuinely unpriced usage must still show that caveat.

Run against the unmodified file: 1 failed / 1 passed — the free-local case failed exactly
as QA described (`dd` rendered "50,000 tokens billed at an unknown rate ... this total may
understate real spend" right next to a "free" cost line for the same connection).

**GREEN:** One-line condition fix —

```
- {usage.unpricedTokens > 0 && (
+ {usage.unpricedTokens > 0 && c.residence !== "local" && (
```

Mirrors the exact pattern `spendStamp()` (`Dossier.tsx:35-43`) and `ProvidersList.tsx`'s
`rowCostLabel()` (`:43-46`) already use for the same distinction. Re-ran: 2/2 passed.

## Finding 2 — usage numbers never refreshed after a run

**Files:** `frontend/src/components/agent-run/useRunStream.ts`,
`frontend/src/components/agent-run/useRunStream.test.ts`

Read `useRunStream.ts` in full before touching it (Story 1 built the surrounding
post-run effect and its docstring at `:69-99`; left that docstring and the
`reportRunOutcome` loop untouched). `usageStore.ts` and `usageStore.test.ts` were **not**
modified — `refresh()` itself already worked and was already tested
(`usageStore.test.ts`); the only gap was that nothing in production called it. Mechanism
chosen: piggyback on the same condition that already credits `reportRunOutcome` (a real,
non-mock segment reaching `state:"done"`) — this is the exact hook QA suggested and it is
the only wiring hook inside this story's file scope (Providers-screen-visibility would
require touching `AppShell.tsx`/`Panel.tsx`, both out of scope).

**RED:** Added two new `describe` blocks worth of tests to `useRunStream.test.ts`
(9 pre-existing Story 1 tests left byte-for-byte alone, only a new import and one stub
line added to their shared `beforeEach` — see below):
- direct-mode real run finishes → `useUsageStore.getState().refresh()` called once.
- a harness node's own real adapter finishes (composer's own connection idle) → refresh
  still called once.
- a run that silently fell back to mock → refresh NOT called.
- a run that errors for a provider-unrelated reason with no segment reaching "done" →
  refresh NOT called.

Also added `useUsageStore.setState({ refresh: vi.fn().mockResolvedValue(undefined) })` to
the **existing** `beforeEach` in the first (Story 1) describe block — necessary because
once `useRunStream.ts` unconditionally imports `usageStore`, every one of Story 1's own
passing tests would otherwise trigger a real `fetch("/usage/summary")` as a side effect.
This is the only edit made to any of Story 1's 9 tests; their assertions and bodies are
untouched, and all 9 stayed green throughout.

Ran before the fix: 11 passed / 2 failed (both new "should refresh" cases — 0 calls
recorded, as expected; the two "should not refresh" cases passed trivially since nothing
called it yet).

**GREEN:** In the existing post-run effect, after the existing crediting loop:

```ts
if (credited) {
  reportedRunIdRef.current = run.runId;
  void useUsageStore.getState().refresh();
}
```

Plus the `useUsageStore` import. No other line in `useRunStream.ts` changed. Re-ran: 13/13
passed.

### Known limitation, disclosed honestly (not fixed, out of file scope)

A run consisting **only** of a single node that hits its per-agent token limit (backend
`engine.py:516-532`, `node_error` with a real `tokens` field on the wire) will not trigger
a refresh, because `runReducer.ts`'s `node_error` case (`runReducer.ts:193-203`) does not
currently copy `action.data.tokens` onto the segment — so `credited` stays `false` (no
segment ever reaches `"done"`) and there is no other token count for a broader condition
to key off. `runReducer.ts` is not in this story's file scope (would require restructuring
a file owned by the harness-graph rendering path, not this bounce). Practical impact is
narrow: any run with at least one other real segment that completes normally still
refreshes correctly; only the single-node, limit-stopped-on-its-only-node case is missed.
Flagging for the backlog rather than silently leaving it undiscovered.

---

## Visual quality gate (Hallmark)

`Dossier.tsx` carries a Hallmark stamp (`genre: modern-minimal editorial workspace ·
macrostructure: Curated Library · design-system: design.md`), so the changed UI ran
`hallmark audit`, scoped to exactly the changed region (the Usage block's unpriced-caveat
conditional) rather than re-auditing the whole screen. Checked against `design.md`
(locked token system, Curated Library / spec-sheet rules) and `anti-patterns.md`:
token discipline (the caveat's only style, `color: var(--warn)`, is a named token, not an
inline value — unchanged by this fix), copy hygiene (real em-dash, no straight quotes/
ellipsis, no invented metrics), structural fit (same `dl`/`dt`/`dd` pattern as the
sibling `tokens`/`cost` rows either way, no new markup or component), and wrap behaviour
(static prose in a fixed-label definitions list, not a clickable affordance, so natural
wrapping is correct, not the two-line-clickable-text tell).

**Result: 0 critical · 0 major · 0 minor. Verdict: clean, no revision needed.**

## Test evidence

```
frontend/  npx vitest run                         58 files / 260 tests passed, 11.18s wall
frontend/  npm run typecheck                       tsc --noEmit, exit 0, 3.1s
```

260 = the 254 QA/SEC both independently counted, + 2 new (`Dossier.test.tsx`) + 4 new
(`useRunStream.test.ts`'s new describe block). File count 57 → 58 (one new test file).
No suite or individual test approached the ~30s hang bar (full run 11.18s; longest prior
individual test unaffected).

Scoped re-run immediately after each fix (not just the final full pass):
```
Dossier.test.tsx                                   2/2 passed
useRunStream.test.ts                               13/13 passed
usageStore.test.ts (untouched, re-checked anyway)  5/5 passed
```

## File scope compliance

Touched: `Dossier.tsx`, `Dossier.test.tsx` (new), `useRunStream.ts`,
`useRunStream.test.ts`. Not touched: `usageStore.ts`, `usageStore.test.ts` (no change
needed — see above), `providerStore.ts`, `chatProvider.ts`, `ChatProviderPicker.tsx`,
`canvas/**`, `sidebar/PropertiesPanel.tsx` (its pre-existing `tokenLimit` test file left
as-is). Confirmed via `git status` scoped to these paths before finishing — only
`Dossier.tsx` and `useRunStream.ts` show as modified-tracked; the four test/store files
show as the same untracked new files Story 2 already had before this pass (I extended two
of them, created one, left `usageStore.*` alone). No `git add`/`commit`/`stash`/
`checkout --`/`clean` run at any point, per the shared-checkout constraint.

## Other reports read, not acted on

`security.md` had already landed in this directory by the time this pass started (SEC
verdict: FAIL, 4×P2 + 4×P3, none in Story 1). Read it for awareness per the task brief.
None of its findings are in this pass's two required fixes, and its own routing table
sends the `useRunStream`-adjacent half of P2-1 to FE separately, not as part of this QA
bounce — leaving that for Sonnet to route explicitly rather than folding it in unasked.
Not fixed here: P2-1 (intrinsic-node `adapter` spoofing), P2-2/P2-3 (budget NaN/Infinity,
backend), P2-4 (unpriced-model budget bypass, backend), or any P3. Also not fixed: the
budget-check-vs-commit concurrency race QA itself flagged as "worth knowing, not required
to fix" (`usage_tracking.py:202-224`, backend, out of file scope regardless).

## Operational note carried forward

QA reported `:3000`/`:8000` unreachable during their pass. Not needed for this fix — both
findings and their tests are verified entirely through the automated suite (no dev server
required, matching how Story 1/2's own tests already run). Did not attempt to start or
restart either server.

---

# BE pass — remaining backend SEC findings (P2-1 backend half, P2-4, P3-2, P3-4)

Date: 2026-09-15, BE, fresh work resuming after a prior BE attempt died on a session rate
limit (no ledger entry survived from that attempt — only `budget-fixes.md`, its AC/seam
notes for P2-2/P2-3/P2-4/P3-1/P3-2/P3-3, and `evidence/test-results.txt`, an independent
QA run, both predating this pass). Verified fresh against disk before touching anything, as
instructed — did not trust cached line numbers or the prior attempt's plan.

**Confirmed already done, not re-touched:** P2-2/P2-3 (NaN/Infinity budget) —
`usage_tracking.py`'s `set_budget_limit` and `_status_from` both use `math.isfinite`,
pinned by `tests/test_budget_fixes.py` (4 tests: parametrized NaN/Infinity/-Infinity/1e400
rejection, legacy-inf-in-DB safe read + gate refusal + recovery, single-token rounding
precision). P2-1's adapter-backed-node half (`connection_id` + `provider_verified: true` on
`node_done`, `engine.py:560-561`) and the frontend crediting guard (`useRunStream.ts:88-89`
requires both, ignores `s.adapter` entirely for that decision) — read, confirmed present,
not modified.

## Item 1 — P2-1 remaining half: intrinsic nodes trusted `data.adapter`

**File:** `backend/engine.py`, `_node_view()` (was lines 122-132).

Confirmed the bug exactly as SEC described: `"adapter": data.get("adapter", "mock")`
unconditionally, consumed verbatim by all four intrinsic branches (`input`/`output`/
`router`/`hitl`, ~lines 297/310/322/342 pre-fix) on `node_start`, and by the `run_start.order`
preview list (line 201). The adapter-backed branch overwrites it correctly
(`node_view["adapter"] = adapter_name`, line 429) — only the intrinsic path was ever wrong.

**RED:** New file `backend/tests/test_engine_intrinsic_adapter_spoofing.py`, 4 tests:
- `test_input_output_router_intrinsic_nodes_ignore_spoofed_adapter` — full mock-mode run of
  input->router->output, each node's `data.adapter` spoofed to `"claude"`; asserts both
  `run_start.order` and every `node_start` report `"mock"` for all three.
- `test_hitl_intrinsic_node_ignores_spoofed_adapter` — the exact reachability SEC verified
  (a HITL gate with spoofed `data.adapter`). Partial-consumes the generator up to that node's
  `node_start` (breaks before `park()` would ever be awaited — no hang risk, confirmed: full
  file runs in 3.22s) since resolving the gate isn't needed to observe the bug.
- `test_adapter_backed_node_is_unaffected_by_the_intrinsic_fix` — control: an `llm` node must
  keep reporting `"mock"` in mock mode same as always (this test was written to double as a
  regression guard against a future "fix" that widens the intrinsic branch too far).

Ran pre-fix: 2 failed (`'claude' == 'mock'` on both the order-list and node_start
assertions) / 1 passed (the control) — confirmed the vulnerability reproduces exactly as
SEC's empirical section describes, on current disk state.

**GREEN:** `_node_view` now computes `is_intrinsic = node_type in _INTRINSIC` once and sets
`"adapter": "mock" if is_intrinsic else data.get("adapter", "mock")` — forced from the
engine's own knowledge of the node type, never from graph-author-supplied `data`, per the
task's explicit instruction ("force it, don't trust data"). Re-ran: 4/4 passed.

**Why no frontend change was needed** (file-scope constraint required checking this before
assuming a one-line FE test was needed): `useRunStream.ts:88-89`'s crediting guard already
requires `data.provider_verified === true` AND a non-empty string `connection_id` on
`node_done` — neither of which any intrinsic branch's `node_done` ever carries (checked:
none of the four intrinsic `node_done` payloads include either key, with or without this
fix). That guard was added independently (FE's Story-2 bounce-fix pass, per this ledger's
first entry) and already closes the "Verified by a real run" spoofing vector on its own.
This backend fix closes the underlying lie at its source instead of relying solely on that
consumer-side guard (defense in depth, and the event vocabulary is a documented contract
other consumers read too), and incidentally stops a spoofed intrinsic node from
spuriously triggering `useRunStream.ts:64`'s post-run usage-refresh check
(`s.adapter !== "mock"`) — a cosmetic side effect (an extra harmless `refresh()` call, no
wrong data shown), not a security issue on its own, but no longer possible either way.
`useRunStream.ts`, `useRunStream.test.ts`, and `runReducer.ts` were read (per the task's
instruction to read fresh before assuming) but not modified.

**Verification:**
```
tests/test_engine_intrinsic_adapter_spoofing.py                    4 passed
tests/test_engine_*.py (all 4 other engine test files)            23 passed total (incl. above)
full backend suite (.venv/Scripts/python.exe -m pytest -q)        341 passed, 5 warnings, 19.91s
```
This pass's own fresh full-suite count is 341 passed — taken as directly observed, not
reconciled against the task brief's "338" baseline (which was already several fixes stale by
the time this pass started, per the brief itself). No suite or individual test approached
the ~30s hang bar (19.91s full run; longest single file 6.12s for the five engine files
together).

File scope: only `backend/engine.py` and the one new test file touched for this item.

## Item 2 — P2-4: unpriced-model budget bypass

**Files:** `backend/usage_tracking.py` (`enforce_budget_or_raise`), `backend/routers/execution.py`
(both call sites: `run_harness` ~line 253-260 pre-fix, `run_direct` ~line 388-393 pre-fix).

Confirmed still open by grep before starting, as the task brief said. Re-derived the fix from
first principles against current disk state (did not reuse the prior BE attempt's
`budget-fixes.md` seam notes for this item, since that file is a plan, not confirmed-shipped
code, and the task brief explicitly said P2-4 was not done).

**Design decision, stated explicitly:** SEC's own report frames the genuinely-free exemption
two ways in different places — `residence` (local vs. not) in the summary/fix line the task
brief quotes verbatim, and `billing` (subscription vs. credits) in its fuller per-model
walkthrough (anthropic/cursor/openai are cloud+subscription and genuinely $0 regardless of
catalog match). This pass implements the **residence-only** check, matching the task's exact
instruction ("the resolved connection is not a genuinely-free local residence") and its three
named test scenarios verbatim. Consequence, disclosed rather than hidden: a subscription-
billed cloud connection (anthropic/cursor/openai) running a model absent from the catalog
under a configured budget will now also be refused, even though its true cost is $0 — the
built-in catalog models for all three (`claude-opus-5`, `-sonnet-5`, `-fable-5-1`,
`-haiku-4-5`) are already priced, so this only bites a hand-typed exotic model string on one
of those connections, not normal use. This is a fail-closed choice ("can't verify -> refuse"
rather than "can't verify -> assume free"), consistent with SEC's own fix option (b). Flagging
for PO/SEC re-review in case billing-awareness is wanted instead of residence-only — that
would be a follow-up refinement to the same function, not a new surface.

**RED:**
- `tests/test_usage_tracking.py`, 6 new unit tests appended after the existing
  `enforce_budget_or_raise` section: refuses (budget set + unpriced + non-local), error
  message names the model, allows (no budget configured), allows (local residence, budget
  set), allows (catalogued model, budget set), allows (no model info passed at all — the
  exact pre-existing call shape every earlier test in the file already uses, confirming this
  is additive not a behavior change for callers that don't opt in).
- `tests/test_execution_budget_enforcement.py`: added a `residence: "local"` connection
  ("ollama-local") to the shared fixture (additive — no existing test references it), plus 4
  new HTTP-level tests: `/execute/direct` refused for unpriced+cloud+budget-set, allowed for
  unpriced+no-budget (with `unpricedTokens` asserted on the summary), allowed for
  unpriced+local+budget-set, and `/execute/` (harness graph) refused for the same
  unpriced+cloud+budget-set shape — confirms the fix reaches both real-spend endpoints, not
  just the unit-level function.

Ran pre-fix: 7 failed (5 unit — `TypeError: unexpected keyword argument 'model'` — + 2
integration, both `assert 200 == 402`) / 32 passed (unit file) — the "should still allow"
cases passed trivially since nothing restricted them before the fix either, exactly as
expected for additive RED.

**GREEN:**
- `enforce_budget_or_raise(db, *, model=None, residence=None)` — two new optional kwargs,
  default `None` so every existing call site (there were 6 across the test suite, all
  unmodified) keeps its current behavior untouched. After the existing invalid/exceeded
  checks, a third condition: `if status.limit_usd is not None and model and residence !=
  "local" and blended_price_per_mtok(model) is None: raise BudgetExceededError(...)`. Reuses
  the existing `blended_price_per_mtok` already in module scope — `compute_cost`'s arithmetic
  itself is untouched, exactly as the task said not to change it. Independent of `state`
  (fires at "ok", not just "warning"/"exceeded") since the problem is unrelated to how much
  headroom is left — it's that this run's cost would be invisible to whatever headroom
  exists.
- `routers/execution.py`: new helper `_first_provider_model_and_residence(graph, connections)`
  next to the existing `_first_provider_ids` (same "first node with a `providerIds`
  speaks for the whole run" assumption that function's own docstring already documents,
  reused rather than re-invented) — walks the graph once, mirrors
  `providers.resolution.resolve_node_provider`'s own node-model-else-connection-default
  fallback as a read-only preview (explicitly commented as not a second source of truth for
  it), returns `(None, None)` when no node has a provider pinned yet (deliberately not this
  gate's job to also complain about that — `resolve_node_provider` already does, per-node, at
  actual run time).
  - `run_harness`: the existing early `enforce_budget_or_raise(db)` call now passes
    `model=pre_model, residence=pre_residence` from that helper, using the `connections` dict
    already fetched one line earlier (line 266) — no reordering relative to triage/resolution.
  - `run_direct`: moved the one-line `connections = getattr(request.app.state,
    "provider_connections", {})` fetch a few lines earlier (pure state read, no side effect)
    so it is available at the existing budget-check point; computed `pre_model`/`pre_residence`
    from `body.model`/`body.connection_id` with the same node-model-else-default fallback
    pattern, passed into the same `enforce_budget_or_raise` call. Deliberately did **not**
    reorder resolution before the budget check (which would have let a bad `connection_id`
    surface its own, more specific error ahead of a budget refusal) — kept the existing
    precedence (budget gate before resolution) exactly as it already was for the
    already-exceeded case, just extended to see the model too.

Re-ran: unit file 28/28, both files together 45/45.

**Verification:**
```
tests/test_usage_tracking.py + test_execution_budget_enforcement.py + test_budget_fixes.py   45 passed, 5.13s
full backend suite (.venv/Scripts/python.exe -m pytest -q)                                    351 passed, 5 warnings, 20.56s
```
351 = 341 (after item 1) + 10 new tests (6 unit + 4 integration) this item added. No suite or
individual test approached the ~30s hang bar.

File scope: `backend/usage_tracking.py`, `backend/routers/execution.py`, and the two extended
test files. `backend/adapters/catalog.py` and `backend/routers/usage.py` were read (to confirm
`residence` values and the existing `unpricedTokens` surface) but not modified — neither
needed a change for this fix.

## Item 3 — P3-2: triage intake spend never recorded on a real harness run

**Investigated first, per the task's instruction — confirmed still open, not already fixed.**
Read `triage.py`'s current `route_message()` fresh (it has changed since SEC's report: the
`connection_id`/`model` fields already exist on `RouteResult` today, docstring says they're
"populated alongside" `adapter_name`/`tokens` — but the population logic itself still matched
SEC's description exactly). Read `routers/execution.py`'s actual usage-recording logic (not
the brief's line numbers, which had already drifted from my own earlier edits in items 1-2)
to see whether `routed`'s telemetry reaches `record_usage_rows` on the `engage_harness=True`
path. Confirmed it does not — `routed` was read only for `.engage_harness` in `run_harness`,
never contributed a ledger row, while the `engage_harness=False` path was already correct
(its spend rides through as a normal node via `_reply_only_events` -> `events` ->
`_usage_rows_from_events`, tagged `source="harness"`).

**Two-layer bug, both layers fixed:**

1. `triage.py`: of the four `engage_harness=True` return points, two (`result.error` truthy;
   `text` empty or exactly the engage-harness token) occur *after* `invoke()` already
   returned a `result` carrying real `tokens_used` — but both discarded it, returning the
   dataclass's all-zero defaults. The other two (`if not instruction.strip() or not
   provider_ids`; `except ProviderResolutionError`) never call `invoke()` at all, so `tokens=0`
   there is already correct — left unchanged, confirmed by adding explicit `assert
   routed.tokens == 0` to their existing tests. `except Exception` around `invoke()` itself
   (the call raising, not returning an error result) also left unchanged — no `result` object
   exists there to salvage anything from.
2. `routers/execution.py`: `run_harness`'s `event_stream()` finally-block only ever built
   `usage_rows` from `events`. Added: when `routed is not None and routed.engage_harness and
   routed.tokens > 0`, append one `source="triage"`, `node_id=None` row built from `routed`'s
   fields, alongside the existing `_usage_rows_from_events(...)` list, before the single
   existing `record_usage_rows` call — reuses that function's existing zero-token/no-adapter
   guard rather than duplicating it.

**RED:**
- `tests/test_triage.py`: extended `_StubAdapter` with an optional `tokens_used` param
  (default 5, matches the old hardcoded value — every existing call site unaffected). Added
  token/connection_id/adapter_name assertions to the three tests hitting the two fixed
  branches (`test_the_engage_token_routes_to_the_full_harness`,
  `test_hands_off_when_the_call_errors` with a new `tokens_used=7` on its stub,
  `test_hands_off_when_the_reply_is_empty` with `tokens_used=3`), plus one-line zero-token
  confirmations on the two no-call-made tests (`..._no_provider_pinned`,
  `..._connection_cannot_resolve`). Ran pre-fix: 3 failed (`assert 0 == 5/7/3`) / 7 passed
  (including both new zero-token confirmations, correctly already true).
- `tests/test_execution_budget_enforcement.py`: two new HTTP-level tests —
  `test_triage_intake_spend_is_recorded_when_it_engages_the_harness` (a stub returning
  `tokens_used=42` on the intake prompt and `100_000` on the real harness node; asserts
  `bySource` has both `"triage": 42` and `"harness": 100_000`, summed `totalTokens == 100_042`)
  and `test_triage_reply_only_path_is_still_recorded_exactly_once` (regression
  guard: the already-working reply-only path must not be double-counted by the new logic —
  asserts `"triage" not in by_source` when `engage_harness=False`). Ran pre-fix: 1 failed
  (`KeyError: 'triage'` — confirms the exact gap SEC described, reproduced fresh against
  current disk state) / 12 passed (the regression guard already passed, since that path was
  never broken).

**GREEN:** both fixes above. Re-ran: `test_triage.py` 10/10, both new integration tests
included in `test_execution_budget_enforcement.py` 14/14, `test_execution_provider_resolution.py`
(unmodified, re-run as a wider regression check since it exercises the same triage/harness
wiring) 14/14 — 38/38 across the three files together.

**Verification:**
```
test_execution_budget_enforcement.py + test_triage.py + test_execution_provider_resolution.py   38 passed, 4.66s
full backend suite (.venv/Scripts/python.exe -m pytest -q)                                        353 passed, 5 warnings, 20.52s
```
353 = 351 (after item 2) + 2 new test functions (`test_triage.py` gained assertions on
existing tests, not new test functions; `test_execution_budget_enforcement.py` gained the 2
new ones). No suite or individual test approached the ~30s hang bar.

File scope: `backend/triage.py` (docstring + the two return statements — no control-flow
change, no new branches, matches "read-mostly, minimal touch"), `backend/routers/execution.py`,
`tests/test_triage.py`, `tests/test_execution_budget_enforcement.py`.

## Item 4 — P3-4: automations budget-gate coverage claim

**Investigated first, per the task's instruction.** The task brief said SEC's cited
`scheduler.py` "doesn't exist as a separate file" — that turned out to be wrong: fresh grep
found `backend/automations/scheduler.py` (a package module, not a bare top-level file) very
much does exist, holding `mock_execute`/`run_job`/`AutomationScheduler`/`ExecuteFn`. Trusted
the fresh grep over the brief, per this task's own "verify against current disk state" rule.

Traced both real-execution paths end to end, fresh:
- **Cron-fired:** `main.py:38` — `scheduler = AutomationScheduler(SessionLocal)`, no
  `execute_fn` argument. `AutomationScheduler.__init__` (`scheduler.py:133`):
  `self.execute_fn = execute_fn or mock_execute` → always `mock_execute` in production.
- **On-demand:** `routers/automations.py`'s `POST /{job_id}/run` (`run_now`, line 149-155)
  calls `run_job(db, job_id)` with no `execute_fn` override either → same default.
- `mock_execute` itself (`scheduler.py:63-87`) touches only `FakeRepoProvider` (for the
  optional `pr_watch` stub, itself explicitly named "stub" and hardcoded to the fake
  provider, never a real `repos/github.py`/`gitlab.py`) — no adapter, no `execute_harness`,
  no network call. Confirmed via `grep execute_harness` across the whole backend: only
  `routers/execution.py` and `engine.py` (plus their tests) reference it — never
  `automations/`. The only place a *non*-default `execute_fn` is ever passed is
  `tests/test_scheduler.py`'s own test of the injection mechanism itself, not production
  wiring.

Conclusion: automations have no real spend path anywhere in the current codebase — the
task's second branch applies. Did not add a budget-gate call with nothing real to gate
(would be dead code asserting a false sense of coverage); corrected the docstring instead.

**Test first, honestly framed:** a docstring-only fix has no natural RED state (no behavior
changes), so rather than fabricate one, added the regression-pinning test *before* editing
the docstring, ran it against current code to confirm it demonstrates the gap the old
docstring's claim papered over, then corrected the docstring to match. The test then serves
as an ongoing pin, not an artifact of a red/green cycle that didn't apply here — noted
explicitly rather than silently claiming standard TDD where the situation didn't fit it.

- `tests/test_scheduler.py::test_run_now_ignores_an_exhausted_budget` (new): sets
  `limitUsd: 0` (blocks all real spend per `_status_from`'s existing semantics), creates a
  `harnessEnabled: true` job, hits `/automations/{id}/run`, asserts `200`/`"complete"`/
  `result.mode == "mock"` — proving a maxed-out budget does not, and today cannot
  meaningfully, block an automation run. Ran standalone first: passed immediately (6/6 in
  the file) — confirms the gap this docstring fix is honestly describing, not a hypothetical.

**GREEN (docstring correction):** `backend/models.py`'s `BudgetConfig` docstring no longer
lists "automations" among covered real-spend paths. Added: an explicit "not covered yet"
paragraph naming the exact call sites checked (`main.py`'s scheduler construction,
`routers/automations.py`'s `/run` endpoint), why (`execute_fn` defaults to `mock_execute`
everywhere in production), the new pinning test by name, and what must happen before the
docstring can honestly say "automations" again (`enforce_budget_or_raise`, wired the same way
`routers/execution.py` already does, at the point a real `execute_fn` is ever attached).

**Verification:**
```
tests/test_scheduler.py + test_automation_validation.py + test_cowork_automations_api.py   50 passed, 1.42s
full backend suite (.venv/Scripts/python.exe -m pytest -q)                                   354 passed, 5 warnings, 20.70s
```
354 = 353 (after item 3) + 1 new test. No suite or individual test approached the ~30s hang
bar.

File scope: `backend/models.py` (docstring only, per the task's own conditional instruction —
no other line touched), `tests/test_scheduler.py`. `backend/automations/scheduler.py`,
`backend/automations/pr_watch.py`, `backend/routers/automations.py`, and `backend/main.py`
were read in full to trace the wiring but not modified — there is nothing real to gate yet.

---

# Closing summary — all four items, fresh full-suite confirmation

All four assigned items done. Final counts, this pass's own fresh runs (not carried forward
from any earlier report):

```
backend/   .venv/Scripts/python.exe -m pytest -q -p no:cacheprovider     354 passed, 5 warnings, 20.70s
frontend/  npx vitest run --run                                          58 files / 262 passed, 8.10s
frontend/  npm run typecheck                                             tsc --noEmit, exit 0
```

Frontend counts (262/262, 58 files) are unchanged from the task brief's stated baseline, as
expected — no frontend file was read for editing purposes beyond the two named in the brief
(`useRunStream.ts`, its test file), both read-only, confirmed already correct, not modified.
Backend went from 338 (brief's stated baseline, itself already slightly stale) to 354 — 16
new/extended tests across items 1-4 (3 + 10 + 2 + 1), zero removed, zero skipped, zero
regressions in any pre-existing test. No suite or individual test at any checkpoint in this
pass approached the ~30s hang bar (longest: full backend suite at 20.70s).

**Full file-scope summary (all four items combined):**
- Edited: `backend/engine.py`, `backend/usage_tracking.py`, `backend/routers/execution.py`,
  `backend/triage.py`, `backend/models.py`.
- Not edited, per the task's own conditional guidance confirmed correct after investigation:
  `backend/routers/automations.py` (read fully, wiring traced, no real spend path found —
  nothing to gate), `backend/routers/usage.py` (read, already correct from the earlier
  P2-2/P2-3 pass).
- New/extended tests: `tests/test_engine_intrinsic_adapter_spoofing.py` (new),
  `tests/test_usage_tracking.py` (extended), `tests/test_execution_budget_enforcement.py`
  (extended), `tests/test_triage.py` (extended), `tests/test_scheduler.py` (extended).
- Untouched, confirmed already correct/not this pass's job: `backend/adapters/catalog.py`,
  `backend/providers/resolution.py`, `backend/automations/scheduler.py`,
  `backend/automations/pr_watch.py`, `backend/main.py`, every `frontend/` file.

No commit made (shared, uncommitted checkout — commits are HITL's call per the harness
contract). `git status` not re-run destructively at any point; no `stash`/`checkout --`/
`clean` ever invoked. Per the task's explicit instruction, no final consolidated handoff or
self-declared "fixed" claim written here beyond this ledger — Sonnet's fresh QA+SEC re-pass
is the next gate.


## Sonnet direct fix — 2026-09-15, closing the QA-sharpened P2-4 gap

The dispatched fix for SEC's second P2-4 finding (positional bypass, fixed by moving
enforcement into `engine.py`'s node loop) died mid-verification on a session rate limit.
Disk state confirmed complete and correct on resume (363 backend / 262 frontend passing,
typecheck clean) — the positional-bypass architecture itself is sound, `engine.py:480-490`
checks every real node via its own `resolved`/`config.model`, not a first-node guess.

One gap remained, exactly as the parallel QA closing re-verification had already sharpened:
`enforce_budget_or_raise`'s own logic only fires the unpriced-model refusal `and model` —
an empty/falsy model (a CLI adapter with no `defaultModel` configured, falling back to its
own invisible internal default — OpenAI connections hit this routinely, confirmed by QA)
skipped the check entirely rather than being treated as "definitely unknown, must refuse".

Fixed directly (`usage_tracking.py`): new `model_expected: bool = False` parameter.
Default `False` (every pre-run/preview call site — 7 of them, all unmodified) keeps the
exact existing "no model info yet, nothing to check" behaviour. `engine.py`'s per-node
callback (`routers/execution.py`'s `_enforce_node_budget`, the only caller past a real
`resolve_node_provider()` success) now passes `model_expected=True` — an empty model there
is treated identically to an uncatalogued one: refused when a budget is set and residence
isn't local, with its own honest error message ("no default model set", not "model '' is
not in the catalog", which would have read oddly).

`/execute/direct`'s pre-resolution preview check deliberately left at `model_expected=False`
(default) — it runs *before* `resolve_node_provider()`, is a best-effort guess by
construction (its own comment says so), and direct mode has no multi-node positional-bypass
surface to begin with (exactly one adapter call, nothing to hide behind). Tightening it risks
false refusals on a guess for the single most common path (plain chat) for no closed gap in
return.

Tests: `tests/test_usage_tracking.py` — 2 new (`model_expected=True` + empty model + cloud
residence → refused with "no default model" in the message; same but local residence →
still allowed, exemption survives). 30/30 in that file, 365/365 backend overall (was 363),
262/262 frontend unaffected (backend-only change), typecheck clean. No suite near the ~30s
hang bar.

Not touched: `/execute/direct`'s preview check, `engine.py`'s per-node call site's own
`enforce_budget` invocation (already correct — the fix is entirely inside
`enforce_budget_or_raise`'s own conditional plus the one new keyword argument the callback
passes), anything under Story 1's or Studio's file scope.

Ready for a final fresh QA + SEC re-pass.

## Sonnet — SEC-P2-5 closed, 2026-09-15 (for Codex's coordination)

Closing the last open SEC finding from this story's own review chain (positional
bypass was already fixed; this closes the two paths that never entered the node
loop at all): `triage.route_message()` gained an `enforce_budget` callback
parameter (same shape/contract as `engine.py`'s), called once resolution succeeds
and before its one real adapter call — `BudgetExceededError` deliberately
propagates rather than being swallowed into "fall back to the harness" (that
would spend more, not less). `routers/execution.py` wires `_enforce_node_budget`
into that call and catches the exception as an honest 402. `/execute/direct`'s
budget check moved from a pre-resolution guess to right after
`resolve_node_provider()` succeeds, with `model_expected=True` — same mechanism
Sonnet's earlier `usage_tracking.enforce_budget_or_raise(..., model_expected=...)`
addition already introduced for the harness node loop.

New tests: `test_direct_run_refused_for_no_model_when_budget_configured` (the
realistic shape — no `model` field at all, matching what the composer actually
sends), `test_triage_refused_when_budget_already_exceeded`. Backend 365→367
before this note (concurrent work has since moved the count further — see your
own fresher baselines, not this one).

**Investigated and deliberately NOT applied**: a user-relayed bug report
proposed fixing `providers/resolution.py`'s `_HTTP_ADAPTERS_REQUIRE_MODEL` set
(checks `adapter_name`, "openai" never matches since its adapter is "codex") by
adding "codex" to the set or checking `provider_id` instead. Verified against
`adapters/cli_codex.py:166-173` (`--model` flag only added when
`config.model` is truthy — Codex CLI genuinely falls back to its own default
when none is given, exactly like Claude, confirmed by the adjacent comment in
resolution.py itself) — requiring an explicit model for OpenAI/Codex would be a
real regression, not a fix. Left `resolve_node_provider()` untouched. The
budget-side fix above (model_expected=True treating an empty *resolved* model
as unpriceable) is the correct place for this concern, not provider resolution.

**Coordination note for Codex**: your DIRECT-ADAPTER-RESOLVE ledger says you
reconciled with "Sonnet's per-node budget callback, intake ledger and stricter
direct resolution budget check" already — this entry is that same
direct-resolution budget check's final state (the version you reconciled
against may predate the triage-side half above, added after). If your own
`run_direct()` rewrite already resolves past what this diff touches, re-check
this specific block for conflicts before assuming it's still shaped this way;
I have not re-read your latest `execution.py` state as of this note.
