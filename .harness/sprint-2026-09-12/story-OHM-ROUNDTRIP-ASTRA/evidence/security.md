# Security Review — OHM-ROUNDTRIP-ASTRA

Verdict: PASS. Ready for HITL Review: Story OHM-ROUNDTRIP-ASTRA.

Independent fresh-context SEC review on 2026-09-12, following the authoritative harness SEC.md profile. Read story.md, final qa.md and architecture.md. This sign-off covers the authoring converters, their ValidateDock/HarnessBar wiring, listed regression tests, literal fixture, and two frontend test scripts. No product/test code, backend state, running server, commit or merge was changed by SEC. No introduced P0–P3 finding was identified in this scope; this is not a repository-wide security guarantee.

## Data and trust boundaries

Imported JSON carries arbitrary authoring fields, prompts, provider identifiers, opaque secret references, node/edge metadata and bundle extensions. ValidateDock parses JSON and retains the existing sidecar validation before loading the canvas (`frontend/src/components/studio/ValidateDock.tsx:121`). The authoring converter does not execute prompts, commands, URLs or edge conditions (`frontend/src/lib/bundleGraph.ts:30`). HarnessBar uses that same converter before opening Studio (`frontend/src/components/agent/HarnessBar.tsx:25`). No authentication or authorization flow is added or changed by these seams.

## OWASP Top 10 checklist

| Category | Scoped evidence and conclusion |
| --- | --- |
| A01 — Access control | No new endpoint or privilege operation. Import still requires successful validation before state replacement (`ValidateDock.tsx:123`, full path above). Studio navigation loads graph and manifest only (`frontend/src/components/agent/HarnessBar.tsx:28`). Backend endpoint authorization is outside this frontend slice. |
| A02 — Cryptographic failures | Deprecated raw `data.apiKey` is removed from a cloned object both on import (`frontend/src/lib/bundleGraph.ts:36`, deletion at line 42) and export (`frontend/src/lib/bundlesApi.ts:112`, deletion at line 114); `secretRef` survives. Tests verify exclusion, reference preservation and unchanged input. Session storage persists only enabled/id fields (`frontend/src/store/harnessSessionStore.ts:47`), and canvas loading is an in-memory update (`frontend/src/store/canvasStore.ts:269`). No cryptographic algorithm or transport change. |
| A03 — Injection | File input uses `JSON.parse`, not evaluation (`frontend/src/components/studio/ValidateDock.tsx:122`). Metadata is copied with object spread, without recursive assignment into shared prototypes (`frontend/src/lib/bundleGraph.ts:38`, `frontend/src/lib/bundlesApi.ts:167`). Type resolution checks own map properties (`frontend/src/lib/bundleGraph.ts:23`). Display messages/errors use React children (`frontend/src/components/studio/ValidateDock.tsx:203`, line 214); node label is a React text child (`frontend/src/components/canvas/nodes/BaseNode.tsx:190`). No SQL, shell or HTML execution sink added. Mutation runner uses fixed source strings and `spawnSync(process.execPath, argumentArray)` without a shell (`frontend/scripts/mutate-ohm-roundtrip.mjs:17`, line 26). |
| A04 — Insecure design | Authoring import preserves provider pins/conditions without adding execution prompts or selecting fallback providers (`frontend/src/lib/bundleGraph.ts:30`; execution remains separate at line 76). Import/open-Studio handlers do not start execution (`frontend/src/components/studio/ValidateDock.tsx:135`, `frontend/src/components/agent/HarnessBar.tsx:28`). No authentication endpoint requiring a new rate-limit design. |
| A05 — Misconfiguration | No CORS/debug/server configuration change in scoped source. Test scripts are opt-in npm commands (`frontend/package.json:12`). E2E creates a separate browser context and explicitly intercepts configured sidecar requests, rejecting unexpected requests (`frontend/scripts/e2e-ohm-roundtrip.mjs:17`, line 28, line 41). |
| A06 — Vulnerable components | `git diff -- frontend/package.json` changes only two test script entries (`frontend/package.json:12`); no dependency/version changes. No new component CVE audit was applicable or performed; existing dependency security is not certified here. |
| A07 — Authentication and identity | No token/session authentication implementation change. `secretRef` remains an opaque value, not a credential lookup or authentication bypass in the converters (`frontend/src/lib/bundlesApi.ts:112`, `frontend/src/lib/bundleGraph.ts:37`). Session persistence shape remains enabled/id (`frontend/src/store/harnessSessionStore.ts:49`). |
| A08 — Software/data integrity | Existing validation precedes import (`frontend/src/components/studio/ValidateDock.tsx:123`). Unknown node type strings normalize to supported types; inherited `constructor` cannot become a renderer (`frontend/src/lib/bundleGraph.ts:21`; regression `frontend/src/lib/bundleGraph.import-safety.test.ts:13`). JSON metadata stays data in these seams. Mutation targets are a temporary copied src tree and fixed mutations, with per-mutant restoration (`frontend/scripts/mutate-ohm-roundtrip.mjs:9`, line 42, line 50). E2E's module override is a local operator environment setting, not an imported bundle field (`frontend/scripts/e2e-ohm-roundtrip.mjs:8`). |
| A09 — Logging/monitoring | No new production credential logging. Export constructs a JSON Blob and revokes the object URL (`frontend/src/lib/bundlesApi.ts:185`). E2E diagnostic files contain the synthetic fixture/browser failure context from its isolated run (`frontend/scripts/e2e-ohm-roundtrip.mjs:88`); no credential fetching occurs in that script. No auth-event changes requiring new audit events. |
| A10 — SSRF | Arbitrary imported endpoint/mcpUrl fields are not fetched by the authoring converter (`frontend/src/lib/bundleGraph.ts:30`). Validate/mock use fixed sidecar route suffixes (`frontend/src/lib/bundlesApi.ts:85`, line 94). Node URL/command hints render as strings (`frontend/src/components/canvas/nodes/index.tsx:35`). Live backend execution/URL policy remains outside this review. |

## Independent verification

Executed in `frontend`:

```text
npm exec vitest run src/lib/bundlesApi.test.ts src/lib/bundleGraph.authoring.test.ts src/lib/bundleGraph.import-safety.test.ts src/components/studio/ValidateDock.test.tsx src/components/agent/HarnessBar.test.tsx
```

PASS: 23/23 tests, 5/5 files, Vitest 3.2.7, exit 0, duration 1.62s, reported start 09:59:35. Includes apiKey stripping, secretRef retention, prototype-name type normalization, authoring fidelity, and actual File/Blob component integration. No independent SEC browser or mutation rerun; QA's full 170-test/typecheck/E2E results and inspected mutation results are separately recorded in qa.md, not claimed as SEC execution.

## Secrets scan

- Pattern scan of the 12 scoped source/test/script/fixture files checked common API-token/private-key formats and quoted apiKey/password/token/secret assignments. Three candidates were manually inspected: explicit synthetic test values at `frontend/src/lib/bundlesApi.test.ts:129`, line 207, and `frontend/src/lib/bundleGraph.import-safety.test.ts:6`. No actual credential identified.
- `git log --all -p -- <scoped paths>` covered five commits and returned zero pattern candidates. `git log --all --format='%H %s%n%b'` commit-message scan returned zero candidates. This is local reachable history of the scoped paths, not an audit of unrelated historical blobs, remotes, reflogs or ignored files.
- Tracked filename inventory (`git ls-files '*env*' '*secret*' '*credential*'`) showed code/tests/docs and next-env.d.ts, no tracked .env credential file. `.gitignore:8` and `.gitignore:17` protect the documented frontend/backend environment files. It does not supply blanket secrets/credentials-directory ignores; that pre-existing repository configuration is unchanged by this slice.
- Gitleaks/trufflehog were not available via Get-Command. This was a bounded pattern scan plus manual review, not a claim of exhaustive secret detection.

## Limits and disposition

The explicit boundary strips the deprecated node `data.apiKey` field. It is not a general secret scrubber for arbitrary extension fields or prompts; those fields intentionally roundtrip. The already-existing raw parsed activeBundle can remain in memory, and input JSON is sent unchanged to validation before conversion (`frontend/src/components/studio/ValidateDock.tsx:123`, line 135); this slice does not newly persist that raw bundle. Malformed/oversized input resilience and live backend schema, authorization, execution, persistence and SSRF policies were not certified by these checks. Object-spread prototype safety was inspected; the independent automated prototype-name regression specifically exercises `constructor`.

No blocking security finding introduced by the reviewed slice. Proceed to human review; no commit or merge authorization is implied.
