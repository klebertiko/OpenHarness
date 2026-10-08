# Export TDD evidence — OHM-ROUNDTRIP-ASTRA

Owned files: frontend/src/lib/bundlesApi.ts and bundlesApi.test.ts. Parent maintains story ledger, full regression/E2E/mutation and independent gates. No backend edits, commits or merges.

## Agreed seams

- AC1: canvasNodeToBundleNode, composeBundleFromCanvas via bundlesApi.test.ts.
- AC2: canvasEdgeToBundleEdge, composeBundleFromCanvas via bundlesApi.test.ts.
- AC4 export contribution: composeBundleFromCanvas preserves public bundle/graph extensions.
- Security contract: lib/types.ts NodeData.apiKey is deprecated and must not persist; secretRef survives.

## Baseline

2026-09-12: `npm test -- src/lib/bundlesApi.test.ts` PASS, 5/5 tests (870 ms Vitest duration).

## Slice 1 — AC1 authoring node export

Added one behavioral test at canvasNodeToBundleNode with independently specified literal expected output, multiline prompts, Providers, role, position, nested extension and secretRef. The existing compose compatibility assertion checks its historical subset, allowing richer authoring fields.

- RED observed before implementation: `exports complete Agent authoring data and positions without persisting raw credentials` failed because the result only contained id/role/label; 5 passed, 1 failed (Vitest 1.13s).

- GREEN slice 1: `npm test -- src/lib/bundlesApi.test.ts`, exit 0. Tests  6 passed (6)

## Slice 2 — AC2 edge Signals, condition, handles and extensions

Seam: canvasEdgeToBundleEdge via bundlesApi.test.ts. Literal fixture and expected authoring object.

- RED slice 2: `npm test -- src/lib/bundlesApi.test.ts`, exit 1. Tests  1 failed | 6 passed (7)

- GREEN slice 2: `npm test -- src/lib/bundlesApi.test.ts`, exit 0. Tests  7 passed (7)

## Slice 3 — AC1/AC2 composition and public bundle extensions

Seam: composeBundleFromCanvas via bundlesApi.test.ts. Preserves base bundle/graph extension dictionaries and composes the current authored graph.

- RED slice 3: `npm test -- src/lib/bundlesApi.test.ts`, exit 1. Tests  1 failed | 7 passed (8)

- GREEN slice 3: `npm test -- src/lib/bundlesApi.test.ts`, exit 0. Tests  8 passed (8)

- Typecheck: `npm run typecheck` exit 2.

## Type integration correction

Typecheck RED: HarnessNode/HarnessEdge do not declare root index signatures (TS2322 at ValidateDock). Public exporter/compose inputs now use structural generic constraints to accept existing canvas interfaces and arbitrary authored extension fields. Runtime logic unchanged.
- Type integration GREEN: `npm run typecheck` passed with no errors; `npm test -- src/lib/bundlesApi.test.ts` passed 8/8 (Vitest 1.15s).
- Final owned changes preserve complete node/edge authoring objects, compatibility aliases and base bundle/graph extensions. Raw node.data.apiKey is omitted without mutating the live node; secretRef remains.
- Hallmark: N/A for this owned slice (no component, page, CSS or other visual surface changed). Parent owns the UI import changes and visual gate.
- Ready for parent integration / independent QA. Full frontend regression, browser E2E, mutation and independent review remain with the parent as assigned.
- Existing unrelated API URL assertions, .ohm naming and schema fallback edits were present on entry and preserved. No backend edits, server starts, commits or merges.
