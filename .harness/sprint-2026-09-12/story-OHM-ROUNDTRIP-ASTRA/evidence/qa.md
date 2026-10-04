# QA Evidence — OHM-ROUNDTRIP-ASTRA

Gate: Approved for Architecture Review

The first QA bounce is resolved. Independent final E2E rerun passed after correcting test HTTP envelopes and readiness; no production changes were required. All four AC items now PASS. This is the QA gate, not final release/merge approval.

Independent fresh-context QA, 2026-09-12. Read QA profile, story AC, source handoff and TDD ledger before production code. Scope limited to authoring export/compose, authoring import conversion and legacy type-map guard, ValidateDock import and HarnessBar authoring/metadata wiring. No backend, unrelated frontend changes, commits or server operations reviewed/performed.

## Independent execution

- `npm test` from frontend: PASS, 170/170 tests, 38/38 files, Vitest 3.2.7, duration 5.13s, start 07:16:29. Includes unit and File/Blob component integration tests. happy-dom teardown emitted AbortError stderr; Vitest reported no failing tests and exit 0.
- `npm run typecheck`: PASS, tsc --noEmit, no errors.
- Final independent `npm run test:ohm:e2e` using installed Playwright and real existing :3000 UI: PASS, standalone exit 0, command duration 3.69s. Exact output: `PASS: real browser import -> download -> reimport -> download; authored objects equal. Sidecar HTTP stubbed.` Two file imports and two downloads are compared, with zero page errors or unexpected sidecar requests. See current `evidence/e2e/result.json`, first.ohm, second.ohm and roundtrip.png. Isolated Edge context; no live backend writes.
- First QA E2E run failed before import with `locator.click: Timeout 30000ms exceeded.` Studio button became detached. The actual cause was a test stub returning [] for workspace listing, where the UI expects {projects:[]}; Next's error overlay caught the runtime failure without emitting pageerror. Corrected script uses explicit workspace/provider response envelopes, networkidle readiness, rejects unexpected sidecar requests, checks Next runtime overlays, and writes running/passed/failed result states with timestamps. QA inspected the correction and independently reran successfully. Historical failure.txt/png document this resolved bounce; they are not the latest verdict.
- Reviewed mutation runner and final mutation.json: clean baseline, 12/12 targeted semantic mutants killed, 0 survived, 0 invalid, 0 timeout-or-error. Mutations run on a temporary copied source tree with shared dependencies. This is a targeted sample, not an exhaustive program mutation score. QA inspected results; did not independently rerun mutations.
- Coverage: not measured. No percentage or >=80% assertion is made; story DoD requests honest evidence, not an invented coverage threshold.

## AC verification

1. PASS — Complete node authoring export, custom positions/type, Providers, prompts, role and extensions: `frontend/src/lib/bundlesApi.test.ts:114` asserts literal expected data, multiline prompts and raw credential exclusion without input mutation. `frontend/src/lib/bundlesApi.test.ts:191` exercises composition and graph/envelope extensions.
2. PASS — String condition, Signals and handles: `frontend/src/lib/bundlesApi.test.ts:156` checks complete edge object; `frontend/src/lib/bundlesApi.test.ts:191` also checks singular signal through composition.
3. PASS — Authoring import and legacy compatibility: `frontend/src/lib/bundleGraph.authoring.test.ts:5` asserts full modern graph equality; `:20` asserts legacy role/label/default positions. `frontend/src/components/studio/ValidateDock.test.tsx:16` verifies actual legacy File import loads the canvas. `frontend/src/components/agent/HarnessBar.test.tsx:75` verifies unchanged authoring data plus manifest metadata and no execution defaults. `frontend/src/lib/bundleGraph.import-safety.test.ts:4` checks apiKey exclusion/secretRef preservation and `:13` checks prototype-name type safety. All passed in independent full suite.
4. PASS — File/Blob integration passes with literal fixture equality on both cycles at `frontend/src/components/studio/ValidateDock.test.tsx:37` (full assertion `:53`). The corrected `frontend/scripts/e2e-ohm-roundtrip.mjs` independently passed the real browser upload/download/reimport/download flow; its first/second/validation assertions compare full authored objects. Multiline strings are included in full object comparisons; no string normalization. Fixture is literal `frontend/src/lib/fixtures/ohm-roundtrip.json:1`, not serializer-generated expected output.

## DoD verification

- RED/GREEN per implemented slice: recorded in ledger.md and tdd-export.md, with named failures before implementations. Final evidence supersedes earlier pending GREEN notes; ledger still needs completion update by owner.
- Tests written and full frontend regression/typecheck: PASS.
- Browser E2E isolated context, real file/download UI, documented stubs: PASS in final independent execution.
- Mutation isolation and actual outcomes recorded: PASS by inspected script/report.
- Independent QA: this review, Approved for Architecture Review after one resolved bounce. SEC evidence not yet available when checked; later security gate remains required.
- Documentation/handoff: retorno draft reviewed; accurately scopes JSON UI and excludes backend/YAML migration. Its mutation/gate status needs owner update after final results.
- Code committed: NO, intentionally required by story/user HITL instructions. No QA commit or merge.
- Handoff delivery to Sonnet/human and later gates: pending orchestration.

## Gate handoff

@ARCH: all four AC items are verified and tests are passing. Proceed with the architecture gate. Orchestrator owns final ledger/retorno status updates, SEC gate and delivery to Sonnet/human. No serializer/import behavior defect was found in the scoped source review. One QA bounce occurred and was resolved through test-boundary correction plus a clean independent rerun.

## Verification limits

Sidecar validation is stubbed; this does not verify live backend codec, persistence, execution or YAML support. Browser authoring comparison excludes only ReactFlow measured/selected/dragging fields; node/edge data are compared in full. graph.viewport metadata is retained without a viewport restoration UI requirement. Unknown/legacy node types are normalized to supported types, as covered by legacy tests. Independent security approval and human merge are not implied by QA.
