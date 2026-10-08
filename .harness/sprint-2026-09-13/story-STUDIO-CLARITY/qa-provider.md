# Independent QA — provider slice

Date: 2026-09-13. Scope: STUDIO-CLARITY AC1, AC2 and AC5. Production files were read only; no backend changes, commits or server operations were performed by QA.

## Observed verification

- Independent full frontend regression before the Auto configuration correction: 47 files, 199 tests passed.
- Independent full frontend regression including the correction: 47 files, 200 tests passed. Machine-readable evidence: `evidence/qa-regression.json`.
- Command: `npm run test -- --reporter=dot --reporter=json --outputFile=../.harness/sprint-2026-09-13/story-STUDIO-CLARITY/evidence/qa-regression.json` from `frontend`, PowerShell with login disabled.
- Happy DOM emitted background fetch/teardown diagnostics (401 and AbortError). Vitest reported no failed tests.
- No coverage percentage was measured or inferred.

## Acceptance evidence

| Criterion | Test evidence | Result |
| --- | --- | --- |
| AC1: eligibility survives a reload without a fresh probe | `frontend/src/components/agent/chatProvider.test.ts:40` | PASS |
| AC1: an unavailable explicit choice does not silently route elsewhere | `frontend/src/components/agent/chatProvider.test.ts:34` | PASS |
| AC1: Auto explains its selected eligible provider | `frontend/src/components/agent/chatProvider.test.ts:53`; `frontend/src/components/agent/ChatProviderPicker.test.tsx:71` | PASS |
| AC1: selection does not prove verification; status text and dot match health/enablement | `frontend/src/components/agent/ChatProviderPicker.test.tsx:36` and state matrix at line 77 | PASS |
| AC2: unavailable options, keyboard configuration, selection retention and focus restoration | `frontend/src/components/agent/ChatProviderPicker.test.tsx:36` | PASS |
| AC2: active keyboard option remains valid when connections disappear | `frontend/src/components/agent/ChatProviderPicker.test.tsx:99` | PASS |
| AC2: configuring highlighted Auto follows its resolution independently of the explicit chat choice | `frontend/src/components/agent/ChatProviderPicker.test.tsx:113`; included in 200-test run | PASS after QA correction |
| AC5: two agents retain different pins; changing the chat choice or clearing one pin preserves the other | `frontend/src/components/sidebar/PropertiesPanel.provider.test.tsx:37` | PASS |
| AC5: chat fallback fills only unpinned agents | `frontend/src/lib/bundleGraph.test.ts:49` and `:58` | PASS |
| AC5: applying the Studio draft to chat preserves both pins and original OHM content | `frontend/src/lib/studio.test.ts:67` | PASS |

## QA correction — AC2, route @FE

Initial finding: choose Ollama local while an eligible Anthropic connection exists; reopen the picker and press Home to highlight Auto. The Auto row says Uses Anthropic, but the footer offered Configure Ollama local. `configureTarget` used the current explicit selection when the highlighted row had no ID.

FE reproduced the failure in the rendered component, corrected resolution for the highlighted Auto row, and recorded RED/GREEN in `tdd-provider.md`. The independent 200-test run includes the added regression. Configuration must leave `chosenId` and connection/health data unchanged while selecting the intended provider dossier.

## Limits and gate status

The runtime contract was checked against `backend/providers/resolution.py` and `bundleGraphToEngine`: the engine consumes `providerIds[0]`; this slice does not add failover or apply embedded framework Markdown automatically. The remaining IDs are data, not a promised failover policy.

AgentStage still requires an eligible chat provider even if every harness agent is pinned. Studio Run does not inherit the chat chip. Both limits are disclosed in the external handoff and are outside these frontend behavior changes.

Provider unit/component checks pass after the correction. Whole-story approval remains withheld until the browser suite, required viewport/keyboard checks, and final scope verification are complete. See `qa.md`.
