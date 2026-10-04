# Provider clarity FE evidence

Scope: AC1/AC2 at `pickChatProvider`, `chatProviderOptions` and rendered `ChatProviderPicker`; AC5 at the rendered `PropertiesPanel` and existing graph conversion public interface. Parent owns full regression/browser/independent gates.

Contract verified from providerStore hydration and backend/providers/resolution.py: persisted `enabled` is eligibility authority; health is browser probe evidence; engine consumes `providerIds[0]`; chat fills only missing pins. Studio Run has no chat fallback.

Baseline: `npm test -- src/components/agent/chatProvider.test.ts` — 5/5 PASS.

## AC1 — explicit choice

- RED: `keeps an unavailable explicit choice from silently routing to another provider` — expected null, received Anthropic with chosen=false; 1 failed / 5 passed.
- Enabled + setup reload regression already passes, retaining persisted enabled authority.
- GREEN: 6/6 helper tests PASS after the minimal change. No commit per user instruction.

- AC1 helper GREEN: 6/6 PASS after returning null for unavailable explicit choice.

## AC1/AC2 — truthful picker and configuration

Seam: rendered ChatProviderPicker. RED/GREEN below captured before/after production changes.
- RED: picker journey failed finding the Anthropic / Not verified trigger (existing selected chip had no verification state).
- First GREEN attempt exposed an ambiguous test matcher: both Auto and the explicit row name Anthropic. Anchoring the row matcher corrected the test; no production change was needed.

## AC5 — independent agent pins

Seam: rendered PropertiesPanel; choose two agents, revisit them after changing chat choice, clear one pin. Existing providerIds contract retained.
- RED: independent-pin journey could not find combobox Connection pin; inspector previously exposed only adapter and credential.
- GREEN: independent-pin component journey PASS. Different agents retain different providerIds; changing chat choice leaves pins intact; clearing one leaves the other intact.

- Picker test correction: anchored Anthropic option matcher because Auto now correctly names Anthropic too. Original status RED remains valid; no production behavior changed for matcher correction.
- GREEN: provider picker/helper/inspector, graph conversion and AgentStage targeted regressions PASS.
- Typecheck: no provider-owned errors. Shared tree blocked by parent-owned src/lib/studio.test.ts:43 (OHarnessBundle/HarnessBundle manifest incompatibility) and :49 (possibly undefined graph); parent notified and owns correction.

## Targeted verification and visual handoff

- 19/19 PASS across chatProvider, ChatProviderPicker, PropertiesPanel.provider, bundleGraph, AgentStage, AgentStage.composition. Happy DOM emitted teardown AbortError warnings; test process succeeded.
- Hallmark component scope: existing design.md warm graphite/ivory tokens retained; no macrostructure change. Source audit confirms neutral selection check, live-only signal dot, visible unverified/checking/warning/unavailable text, focus-visible styles, disabled choices with separate configuration action, and constrained portal width/left.
- Existing measured portal positioning remains the sole picker style object; all appearance uses named design tokens. Native inspector select reuses existing fieldControl focus/disabled treatments.
- Browser viewport checks (320/375/414/768), visual contrast and fresh-context visual gate remain parent-owned. No invented numeric design score or unobserved browser pass is claimed.
- Provider API/engine untouched. No AgentStage edits. Inspector writes providerIds and preserves other node data; primary changes retain remaining IDs. Labels limit chat-default precedence to harness runs in chat.

## AC2 — live option-list change

- RED: after the connection list shrank while open, aria-activedescendant referenced a removed option (expected non-null element, received null).
- GREEN: both picker tests PASS; active descendant remains valid after options shrink, Home selects Auto, and existing status/configuration journey still passes.

## QA bounce — AC2 Auto configuration target

- RED: explicit Ollama local + highlighted Auto (Uses Anthropic) rendered Configure Ollama local; regression could not find Configure Anthropic.
- GREEN: picker/helper 9/9 PASS. Auto configuration resolves independently of explicit chosenId; configuring it changes only the Providers destination, preserving chat choice, connection state and return focus.
- QA-fix typecheck PASS (tsc --noEmit).
