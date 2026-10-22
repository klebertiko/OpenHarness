# CHAT-PROVIDERS ledger

Contract: docs/product/chat-providers-delivery-2026-10-21.md (AC1–8, DoD, 8 points).
User has explicitly authorized implementation, branch, commit, push and PR; no merge. Sprint goal is the delegated Chat/Providers improvement; no additional approval inferred.

Initial inspection: existing SSE/direct model field and provider usage API allow additive frontend work. Direct chat does not send conversation history. No attachments contract. Preserve backend persistence ownership in the parallel session.

Validation and independent gate results will be appended here before delivery.

## Test-first slices

AC1/2/4: `npm test --prefix frontend -- AgentStage.delivery.test.tsx` initially produced 4 failures (observed before production edits): draft A was cleared after switching; no `Live answer` region; no recoverable alert/reuse after transport failure; no `Model for next turn` control. After the changes, same file: 4 passed. Uses real stores/reducer/start serialization, substitutes sidecar boundary only.

AC3/5/6/7: added focused observable interaction regressions (clipboard accept/reject, archived title search, rename arrow isolation, budget failure input retention, usage refresh, failed/late skill reads, removed-workspace loading). These were added with/after implementation; no historical RED claim for them.

Initial focused suite `npm test --prefix frontend -- src/components/agent src/components/providers src/components/agent-run --reporter=dot`: 47 files, 378 tests passed. `npm run typecheck --prefix frontend`: exit 0. `npm run build --prefix frontend`: exit 0, static export completed; existing Next configuration deprecation/workspace-root warnings remain. Existing unit tests sometimes attempt absent localhost sidecar and print ECONNREFUSED; new delivery tests substitute API boundaries and never invoke a provider. No personal DB/profile used.

SEC independently inspected diff and ran 18 tests: no introduced security finding. Overall security gate remains blocked by unchanged frontend dependency advisories (8 high/2 moderate affected packages); see security.md. This branch adds no dependency and does not claim a clean repository security baseline. Publish as draft for review; do not merge.

## Final implementation and verification

Final source review also aligned Send button with Ctrl/Cmd+Enter for `/read` and `/exec`, using the existing parser and broker payload. Shell syntax warning now gates both entry points. Two delivery regressions verify preset serialization and blocked shell syntax. A stopped-turn test verifies actual stop-control dispatch plus explicit instruction reuse. Completion labels prefer runtime connection/model over the chat default. Streaming follows the bottom until the user scrolls away; Jump to latest resumes following.

`npm test --prefix frontend -- --reporter=dot` at final production delta: 122 files, 920 tests passed, exit 0. `npm run typecheck --prefix frontend`: exit 0. Production build independently repeated by QA: exit 0 (evidence/qa-build.txt). Browser journey uses actual Edge against static export with all sidecar HTTP substituted; no engine/provider/DB executes. Full suite still prints existing ECONNREFUSED diagnostics from older tests aimed at localhost; no failing tests.

Architecture review: changes remain in Chat/Providers and one optional direct-model stream argument; no backend, Activity/Runs, persistence, event store, registry, dependency or schema changes. Durable stream continuation across destination changes/reload and conversational history ingestion remain explicit dependencies in the feature matrix. Existing credentials, readiness and node failover contracts remain authoritative.

Independent QA: functional PASS, 48 files/384 scoped tests, typecheck/build, isolated Edge journey including provider budget/usage recovery, 5 responsive sizes. Negative controls against original sources and a behavioral clipboard mutation confirmed discriminating assertions. See evidence/qa.md. Independent SEC follow-ups reviewed attribution, async reads and slash-button routing; no introduced finding. Architecture review accepts the additive seam above. SEC baseline prevents release/merge approval; draft PR is the reviewable deliverable requested by the user.
