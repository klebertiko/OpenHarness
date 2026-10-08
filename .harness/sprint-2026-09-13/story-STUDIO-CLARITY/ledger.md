# STUDIO-CLARITY ledger

User-requested seams and AC mapping are in story.md. No production edits yet.

Initial evidence: screenshot shows selected Anthropic with setup sublabel and a signal-colored composer dot. Source ChatProviderPicker sets dot to bg-signal whenever pickChatProvider returns any provider; selection does not prove a successful probe. Existing enabled eligibility must remain separate from health.

Provenance investigation in progress: frontend HARNESS_PRESETS includes minimal-gate (3-node sample, mock adapter) and an agile-default visual sketch; backend compiler/default-agile.ohm are separate artifacts. Compiler imports Markdown profiles/process docs; shipped fixture currently also contains a HITL node absent from compiler's coarse graph. Do not claim exact full framework parity.

Reference sources opened: https://github.com/traycerai/traycer ; https://docs.langchain.com/langsmith/studio . n8n official documentation discovery in progress after old advanced-ai URL returned not found.

Implementation and review evidence to be appended per slice. No backend, running server, commit or merge changes.

## Verified TDD progression
- Navigation: studioNavigation.test.ts failed with setStudioView is not a function; GREEN 1/1 after explicit overview/editor state.
- Opening seams: studio.test.ts initially failed 4/4 (missing openBundledHarness/openStudioPreset/newStudioHarness), then passed; initial overview/HarnessBar/library-sheet UI RED had 5 failed and 4 passed, followed by 14/14 GREEN across the five target files.
- Integration follow-up: evidence/integration-red.json records the five intended failures for applying an edited draft to chat, opening a modified default-ID import, editing without enabling chat, title naming scope, and protecting an active run from replacement. evidence/integration-green.json records 22/22 passing.
- Full frontend regression: evidence/regression.json recorded 198/198 passing. Independent QA subsequently observed 199/199 including the final picker cursor regression.
- Typecheck is clean after correcting test-only HarnessBundle typing and removing Testing Library's unsupported exact option (Playwright supports it, Testing Library ByRoleOptions does not).
- Provider TDD and follow-up QA fixes: see tdd-provider.md. Browser and mutation evidence are separate; do not treat HTTP-stubbed execution as a live provider test.

## Additional agreed behavior
Use in chat explicitly applies the current authored graph and bundle content to the chat session without sending a message. This closes the otherwise stale Studio canvas -> chat bundle link. Library selection passes the actual selected/imported bundle to the editor rather than resolving solely by manifest.id. Studio overview hides editor chrome; an empty draft can be named in the editor.
