# Independent QA: CHAT-PROVIDERS

Reviewed working-tree change over `0c89756c1d020a4be748e8523f478a3ce2e2b100`, 2026-10-22. Read delivery contract, ledger, scoped production/test diff and harness `agents/QA.md`. QA changed tests and evidence only. Commands below ran independently in `frontend/` unless specified.

## Independent runs

- PASS — `$ npm test -- src/components/agent src/components/providers src/components/agent-run` → "48 passed (48); 384 passed (384)". See `qa-focused.txt`. No skipped tests. Some existing tests print refused connections to absent localhost:8000; tests still pass. New browser journey blocks/stubs every non-static request.
- PASS — `$ npm run typecheck` → exit 0; `qa-typecheck.txt`. Initial run exposed an incomplete recovery-test capability fixture; implementer corrected it, then QA reran successfully.
- PASS — `$ npm run build` → "Compiled successfully", "Generating static pages (9/9)", exit 0. See `qa-build.txt`. Existing Next configuration deprecation/workspace-root warnings remain.
- PASS — `$ node scripts/run-e2e.mjs chat-providers` → "PASS isolated Chat/Providers journey: 4 checks, 5 responsive sizes"; "All 1 e2e scripts passed." Reran after independent build. See `qa-e2e.txt`, `e2e-chat.json`, `chat-375.png`, `chat-1440.png`.
- PASS — `$ npm test -- AgentStage.delivery.test.tsx ChatComposer.recovery.test.tsx` → "2 passed; 7 passed" before two slash-routing tests were added. The later broad run above includes those two additions (384 total). Final delivery-only rerun includes the strengthened stop-control assertion.

## Acceptance criteria

- AC1 PASS — delivery tests observe draft restoration, live answer isolation, and saved completion in originating chat after switching. Baseline negative control fails both relevant assertions; no implementation self-report required.
- AC2 PASS — delivery tests observe live text without trace, error instruction recovery, and stop-control dispatch plus stopped-instruction reuse without another run. Browser independently verifies completed answer and HTTP 503 recovery. Baseline negative control fails live/error/stopped behavior.
- AC3 PASS — clipboard tests assert exact copied text, confirmation and manual fallback; reuse callback fires once. Browser verifies accepted/denied clipboard feedback and unchanged request count after reuse. A temporary mutation changing `setCopied(true)` to `setCopied(false)` fails the clipboard confirmation test (1 failed/1 passed), proving it discriminates.
- AC4 PASS — delivery test asserts direct payload `model` and unchanged connection default; browser observes `model: qa-model` and `connection_id: ollama-local`. Existing run-stream harness/direct serialization tests pass in the scoped run. Source review confirms harness start ignores direct override. Baseline test fails without model control.
- AC5 PASS — delivery tests observe archived search matches and preserved rename typing/arrows; scoped suite includes existing list navigation tests. Baseline lacks search and fails its observable assertion. Rename isolation is existing behavior retained by the change.
- AC6 PASS — recovery tests assert failed budget value remains 15 with Save enabled and refresh clears prior usage failure. Browser independently exercises usage 503→refresh and budget 503→retained editable value→successful retry. Baseline tests fail missing refresh and retained editor assertions.
- AC7 PASS — failed/late skill-read and removed-workspace loading regressions pass; baseline produces failures for each. Browser checks document overflow is false and composer bounding box fits at 320/375/414/768/1440. QA visually inspected the 375 screenshot: composer, wrapped controls, message actions and recovery card fit. Source review confirms visible focus classes and loading/unavailable text; unit tests cover real capability API boundaries.
- AC8 PASS for required verification/evidence presence — critical suites, independent typecheck/build, browser and independent SEC review exist. Release approval remains blocked by SEC's unchanged dependency findings, as recorded below.

## Discriminating controls

QA created an isolated temporary frontend source copy (path in `qa-temp-path.txt`), copied current tests/config, and linked existing node_modules. Working production files were never changed. In this copy, restored these files with `git show HEAD:frontend/src/<path>`: AgentStage.tsx, ChatComposer.tsx, ThreadsSidebar.tsx, useChatTools.tsx, ProvidersList.tsx, usageStore.ts (component directory prefixes retained).

- `$ node node_modules/vitest/vitest.mjs run src/components/agent/AgentStage.delivery.test.tsx --reporter=dot` → "7 failed (7)" with original AgentStage. Output: `qa-delivery-negative.txt`; failures cover drafts, stream visibility, transport reuse, model override, slash dispatch/warning and stopped reuse.
- `$ node node_modules/vitest/vitest.mjs run src/components/agent/MessageActions.test.tsx src/components/agent/ThreadsSidebar.delivery.test.tsx src/components/agent/ChatComposer.recovery.test.tsx src/components/providers/ProvidersList.recovery.test.tsx src/components/agent/useChatTools.test.tsx --reporter=dot` → "8 failed | 5 passed (13)". Output: `qa-negative-control.txt`. MessageActions was replaced with a null component for this removal control; the other failures use original production sources.
- Replaced temporary MessageActions with current source, then changed only `setCopied(true);` to `setCopied(false);`. `$ node node_modules/vitest/vitest.mjs run src/components/agent/MessageActions.test.tsx --reporter=dot` → "1 failed | 1 passed (2)". Output: `qa-clipboard-negative.txt`. This is a behavioral mutation, not a missing-module import failure.

## Verdict and limits

Functional QA PASS: no remaining introduced functional defect found in reviewed scope. Approved for architecture review with evidence attached. Overall release/merge remains BLOCKED by the independent SEC gate: unchanged dependency advisories, 8 high/2 moderate affected packages; see `../security.md`. QA did not independently rerun dependency audit and does not certify that baseline.

Browser uses a new Edge context, synthetic sidecar frames and test-owned clipboard API; no persistent browser profile, personal DB, credentials, provider probe or paid model call. Immediate fulfilled SSE verifies final visible answer; intermediate streaming visibility and cross-chat ownership are independently asserted through real reducer/store component tests rather than a timed network stream. Responsive checks cover document/composer bounds, not every dropdown state or every assistive technology. Live backend execution and durable replay remain outside this frontend scope. Evidence describes the reviewed working tree; no commit was created by QA.
