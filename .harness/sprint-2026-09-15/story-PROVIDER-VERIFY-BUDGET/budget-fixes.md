# budget-fixes — PROVIDER-VERIFY-BUDGET / handoff section 3
2026-09-15 BE. Accepted contract: handoff section 3 and SEC findings, narrowed by user to usage module/router/models/tests and this ledger. story.md absent; explicit authorized handoff supplies contract. No AC authored here. Skills: harness, tdd, senior-backend. No commits or schema changes.
## AC → seams, before product
- Bullet 1 P2-2/3: set_budget_limit, GET/PUT budget/summary; reject nonfinite input, preserve valid ceiling, safely read legacy corruption.
- Bullet 2 P2-4: compute_cost, record_usage, enforce_budget_or_raise, summary; unknown differs from free and blocks configured budgets.
- Bullet 3 P3-2: record_usage(call_id), idempotent measured intake/partial usage; caller integrates execution/engine.
- Bullets 4/6 P3-3: frozen blended estimate, unrounded storage, explicit local/subscription. Legacy schema cannot preserve token provenance; disclose.
- Bullet 5 P3-1: budget_call context manager serializes check/invoke/persist for adopters in single sidecar. Unbounded individual calls can overshoot.
- Bullet 7: lifetime USD, warning 80%, block 100%; existing status tests.
Test seam: tests/test_budget_fixes.py, temp SQLite and router-only app (no scheduler/providers).
Schema unchanged: legacy nonnullable cost stores numeric placeholder, new summary metadata distinguishes unknown total. Idempotency uses existing PK.
Baseline: usage tracking + API 29 passed (isolated conftest DB).
RED P2-2/3: 3 failed / 1 passed: NaN returns 200, Infinity/1e400 JSON serialization ValueError.
GREEN P2-2/3: 4 passed. HTTP 400 retained via service ValueError (avoids nonfinite input in Pydantic error JSON).
RED legacy Infinity: GET raises JSON ValueError (1 failed).
GREEN legacy: 5 passed; state invalid, null serializable ceiling, gate refuses, PUT recovers. Historical NaN already coerced to NULL cannot be distinguished from intentional unset.
RED precision: one Haiku token cost 0.000002 instead of 0.0000024.
GREEN precision: 6 passed after correcting concurrent test edit contradicting P3-3. Preserved Sonnet model_expected and node callback integration.
RED unknown cost: (0.0,None) != (None,None). Compatibility change intentional: compute_cost returns optional cost; database legacy numeric placeholder retained, price None marks unknown.
GREEN unknown compute_cost + regressions: 37 passed.
RED billing: 4 TypeErrors for new residence/billing kwargs; subscription must not use API catalog.
GREEN billing: 41 passed. New kwargs residence/billing implemented. Legacy residence=local with omitted billing retains Sonnet exemption; new callers must pass billing explicitly. Subscription freezes unknown price even for known API model. Persistent subscription-vs-unpriced and tokens_estimated need schema coordination; not silently accepted/lost.
RED unknown history: configured budget allowed recorded unknown cost.
GREEN unknown history + summary: 49 passed. costComplete/estimatedCostUsd additive; legacy numeric totals remain known subtotals. Unknown history blocks configured lifetime budget (including old local rows lacking explicit free rate).
RED intake idempotency: record_usage rejects call_id. Three concurrent writes, same run/call, must charge once.
GREEN intake idempotency: 13 passed; existing PK uses stable UUID(run_id,call_id), concurrent collision returns original row, no schema changes.
RED concurrency: budget_call missing; two simultaneous calls must yield one spent and one blocked after first commit.
GREEN concurrency: 14 passed; then failure/cancellation release+partial-persistence checks passed. RED extreme finite limit 5e-324: pct overflows JSON, 1 failed / 16 passed.
