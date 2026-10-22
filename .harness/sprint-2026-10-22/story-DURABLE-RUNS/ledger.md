# DURABLE-RUNS

Approved scope: durable run record, append-only event store, versioned output
registry, and Activity/Runs integration. Implementation on
`codex/durable-runs`, starting from `origin/main`; no merge authorized.

## TDD evidence

- Initial backend red: `test_completed_run_has_ordered_pages_and_recoverable_output`
  failed with `KeyError: coverage` before implementation.
- Initial frontend red: interrupted status normalized to complete; unknown
  status normalized to complete. Both assertions failed before the API update.
- Security regression red: split `sk-p` / `roj-...` survived concatenation;
  closing after `node_done` produced complete without a terminal event.
- QA regression red: streaming `thinking` lost its final suffix before a tool
  event. Added an API test proving text/rationale order, in-flight visibility,
  and trailing text preservation on closure.
- Permanent regressions also cover interleaved tool events within provider
  credentials and multiline assignments, legacy coverage, auth, pagination,
  versioned output retrieval, replay without registration, and abrupt process exit.

## Independent reviews

Clean-context QA and SEC agents reviewed the change read-only. Findings above
were fixed and re-reviewed. Final QA: seven run-store tests passed, no remaining
concrete findings. Final SEC: 4,815 synthetic credential cuts (consecutive,
interleaved text, interleaved tool calls), zero exposures; seven run-store tests
passed. Synthetic redaction checks use a fake writer and the real sanitizer;
API tests independently exercise the isolated SQLite store.

## Final verification

- Backend `python -m pytest -q`: 1,684 passed, 40 skipped (isolated DB/profile).
- Frontend `npm test`: 908 passed across 118 files.
- Frontend `npm exec -- eslint . --max-warnings=0`: passed.
- Frontend `npm run typecheck`: passed; final `npm run build` also checked types and exported successfully.
- `git diff --check`: passed.
- QA and SEC: no remaining concrete findings in the reviewed scenarios.
- Browser E2E was not validated in this increment. A filtered runner invocation
  selected zero existing scripts and is not counted as test evidence.

Existing warnings: backend Windows pathlib deprecation; frontend test suites
log refused connections to the absent sidecar, and Next reports existing
configuration deprecations/workspace-lockfile detection. No real sidecar was used.

Validation commands and final counts are also recorded in the PR. Design decisions,
API contracts, and actual limitations are in
`docs/product/durable-run-history.md`.

## Authorized merge follow-up — 2026-10-22

- User authorized merging PRs #136 and #137. #136 merged first; origin/main integrated here without conflicts.
- OpenGrep audit alert on the crash-recovery test was independently reviewed by SEC: fixed script, current interpreter, argv list, no external command input. Made shell=False explicit and documented a rule-specific inline suppression; scanner configuration unchanged.
- Backend integration regression: `python -m pytest -q tests/test_run_store.py tests/test_execution_logs_api.py tests/test_direct_history_bdd.py` → 12 passed.
