# AUTOMATE-REAL

Status: In Progress. User approved 2026-09-15 coordination handoff with “pode fazer”.
PO contract supplied by coordinating agent; supersedes simulation-only scope of
.gauntlet/automate-story.md for this story. Preserve existing UX and local edits.

## Acceptance criteria and seams

1. Scheduled and manual non-simulation runs invoke a registered enabled connection
   using the shared provider resolver; never mock fallback. API and executor tests
   replace external adapters only; no live external calls.
2. Explicit simulation stays labelled simulation and incurs no provider spend.
   Test manual run API and rendered automation result.
3. Execution uses the saved, validated project workspace and optional saved harness;
   missing connection/workspace/harness fails with actionable result. Test executor.
4. Real measured usage (including partial failure) is recorded through usage_tracking
   and calls honor global budget checks; unknown price cannot evade configured budget.
   Test executor and GET usage API against isolated database.
5. Run results, status, error, time and source survive restart. Manual/scheduled runs
   for the same due occurrence cannot execute twice concurrently. Test scheduler and
   API through a fresh read; persist history using a dedicated model if needed.
6. Saved schedule/timezone, enable/disable and edits govern actual due execution.
   Test deterministic clock cases including failed jobs; no activation of live jobs.

## Definition of done

RED/GREEN evidence at the seams above, targeted regression, FE typecheck if touched;
isolated E2E of API/executor plus explicit boundaries for fake external adapters.
Independent QA, ARCH, SEC pending until implementation; no commit or human merge.
Ledger records limitations including unsupported HITL/tool capabilities honestly.

## Ownership

Kepler: backend/automations/*, routers/automations.py, automation tests/UI.
May add separate automation history model module imported by models.py, but coordinate
that single import with parent. Pascal owns usage/budget model edits. Parent owns
engine.py and execution.py. Request public interfaces needed from those owners.
