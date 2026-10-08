# Studio Codex — In Progress

Authority: user handoff 2026-09-15; exclusive Studio scope; no commits, services, paid providers, real jobs or database writes. Existing concurrent changes preserved.

## AC / seams / DoD (before product edits)
1. Sample renders BaseNode without runtime error, inspector edits survive Back/Continue. Seam: real browser Studio flow; scripts/e2e-studio-codex.mjs.
2. Mock/Connected mode and independent connection pins reach the execution HTTP interface unchanged. Same browser seam, explicit intercepted HTTP contracts.
3. Validate/simulation show successful and rejected outcomes, invalidate stale feedback after edits; import/export preserves OHM content/pins and failed imports preserve draft. Same browser seam.
4. Keyboard execution mode selection follows radio-group behavior. Seam: rendered Toolbar; Toolbar.modes.test.tsx.
5. Reconcile compiler/HITL/content against current source; report engine contracts without backend changes.

DoD: observed RED before each new product behavior; GREEN per slice; frontend regression/typecheck; browser evidence; Hallmark audit with actual limitations; independent gates pending unless independently executed.

Initial observation: historical result.json contains ReferenceError Play is not defined. Current BaseNode has no Play reference: reproduce current browser before attributing a fix. API contracts read from routers/bundles.py, lib/api.ts, lib/actions.ts. Browser tests intercept all sidecar requests; no real runtime/provider equivalence claimed.
`n## AC4 RED`nToolbar arrow-key interaction fails: Connected aria-checked remains false after ArrowRight; 1 failed/1 passed. Evidence toolbar-red.txt. Product not yet patched.
