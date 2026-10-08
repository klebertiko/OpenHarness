# FE ledger — 2026-09-15
Own scope: agent-run runClient/useRunStream/types/runReducer and tests; providers/* only. Shared source re-read before edits. Existing DIRECT and PROVIDER ledgers read; user overrides former fallback AC.
## Accepted seams before product
- AC1 -> useRunStream.start / captured startDirectRun payload, useRunStream.test.ts; runClient fetch wire test.
- AC2 -> hook SSE input -> providerStore observable health, useRunStream.test.ts; reducer event evidence.
- AC3 -> hook SSE/close -> usage refresh; reducer public state tokens, runReducer.test.ts.
- AC4 -> Dossier/ProvidersList rendered text and controls; usageStore public state/API boundary.
Contract confirmed by user: DirectRequest.connection_id; node_done provider_verified:true + connection_id; node_error provider_failure authentication|transport + connection_id. Backend delivery owned by user; tests offline.
AC1 RED: direct payload expected connection_id ollama-local, received missing field (13 pass, 1 fail). Baseline 26/26.
AC1 GREEN: useRunStream.test.ts 14/14. AC2 next: event evidence replaces historical fallback expectations.
AC2 RED: node_start metadata incorrectly verified connection (live instead of setup). Success fixtures updated to explicit node_done contract; no historical assertion dropped.
AC2 success GREEN: hook 15/15 (after correcting reviewer fixture to new completion contract). Re-read concurrent Sonnet ledger; BE changes preserved.
AC2 failure RED: authentication/transport expected fault for ol, remained live (2 failures).
AC2 structured failure GREEN: 17/17 hook tests.
AC2 stale RED: superseded callback verified provider (live instead of setup).
AC2 stale GREEN 18/18. AC3 refresh must use terminal events/close, not success evidence.
AC3 refresh RED: errored completion expected refresh once, got zero.
AC3 refresh GREEN 19/19. Terminal/close refresh independent of adapter metadata; old no-refresh expectations superseded by user AC.
AC3 tokens RED: node_error tokens expected 42, received undefined.
AC3 tokens GREEN 7/7. AC4 schema coordination: current FE lacks measurement/pricing provenance; label unavailable breakdown honestly pending BE fields.
AC4 RED: usage cost renders free solely from residence. Test scoped to cost dd (catalog billing label separate). Existing local test expectation migrated to unknown, retains no invented billing warning.
AC4 Dossier GREEN 3/3. Budget RED 4 failures: NaN, +/-Infinity and negative values reached API.
AC4 budget GREEN 9/9. Loading RED: missing role=status in ProvidersList. BE schema now read: costComplete / estimatedCostUsd nullable. Coordinated sole out-of-scope FE type extension lib/usageApi.ts.
AC4 loading GREEN 1/1. Cost contract RED: partial subtotal rendered $1.50 estimated rather than unknown. AC5 added by user: unknown credential metadata and unsupported route controls must be honest (Dossier/CredentialSeal/ModelSection render seams).
