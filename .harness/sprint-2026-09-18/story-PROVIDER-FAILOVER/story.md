# Story PROVIDER-FAILOVER — Automatic, disclosed failover between pinned AI providers

As a harness author,
I want a node's `providerIds[1:]` entries to actually be tried in order when an earlier one fails,
So that a graph keeps running through a dead connection, a missing CLI, a rate limit, or a timeout —
without silently swapping the model that answers, and without duplicating partial output the person
has already seen.

## Context / prior art

`providers/resolution.py` and `docs/product/provider-harness-rule.md` already document the rule this
story must not violate: **a run must never silently swap providers**. `providerIds` is already a
`string[]` end to end (`frontend/src/lib/types.ts:25`, preserved through `PropertiesPanel.tsx:307`,
`bundleGraph.ts`), but only index `[0]` is ever read (`resolution.py:76-83`, `PropertiesPanel.tsx:302`)
— `provider-harness-rule.md` says outright: *"additional array entries are preserved as data, not
advertised as automatic failover."* This story wires that up, on purpose, with the one condition the
existing rule requires: **visible, not silent**.

Scope decision (not ambiguous, technical): repo providers (`backend/repos/factory.py` — GitHub/GitLab/
Fake/Origin) are explicitly **out of scope**. They are not interchangeable backends for the same data
(a GitHub PR does not exist on GitLab), so "failover" has no coherent product meaning there. AC#7
exists only to make this an explicit, checked boundary rather than a silent omission.

Human decisions locked in before drafting (2026-09-28):
- Failover must be **visible/auditable** — a distinct signal in the run's events/segment data, not a
  plain silent swap. Renders like the existing "pinned" badge convention (`Transcript.tsx`).
- The fallback chain is **explicit per node** (`providerIds[1:]`, authored in Studio) — no implicit
  global fallback order.

Revalidated 2026-09-28 against main (`git log --oneline -20`): only CI/deps merges (#2, #22-27) landed
since drafting — none touch `resolution.py`, `engine.py`, `PropertiesPanel.tsx`, or `Transcript.tsx`.
No AC changed. Cross-checked the parallel Nilo Studio work (`frontend/src/lib/nilo/session.ts`,
`reviewReasonsFor`) for a reusable "never silent" convention: it holds a *model-authored chat edit*
for human Apply when `planned.providerPinChanged`— a client-side authoring-time gate, different layer
from this story's runtime/SSE concern, so no code is shared. It does reinforce the same repo-wide
principle AC#4 encodes: a provider-identity change is never silent, whether it happens at authoring
time (Nilo's Apply-hold) or at run time (this story's failover event). AC#5's Transcript badge should
stay visually distinct from `pinnedConnection.ts`'s existing pinned indicator, matching that existing
convention rather than inventing a new visual language.

## Acceptance Criteria

1. A node with `providerIds = [A, B]` where **A fails to resolve** (disabled connection, unknown
   provider, missing credential, unrecognised provider id — today's `ProviderResolutionError` cases)
   automatically resolves and runs on **B** instead of stopping the run — the node's `node_start`/
   segment reports B's `connection_id`, never A's.
2. A node with `providerIds = [A, B]` where A resolves fine but the **first** attempt to get any
   output from A's adapter fails (CLI binary not found, an exception raised before any event, or an
   immediate adapter-level error) before **any content has reached the person** for this node's turn,
   automatically retries on B before emitting a single `node_stream`/`node_reason`/`tool_call` event.
3. Once A has already delivered at least one real content event for this node's turn, a **later**
   failure on A is never retried on B — the node fails exactly as today (`node_error`), so no partial
   output is ever silently duplicated or discarded mid-stream.
4. When B (not the node's first-listed provider) ends up serving the turn, the run's event stream
   carries an explicit, distinguishable signal that a failover happened and which connection(s) were
   tried and rejected first — not just B's `connection_id` indistinguishable from a plain pin.
5. Studio's node inspector (`PropertiesPanel.tsx`) lets an author add, reorder, and remove fallback
   connections beyond the primary pin, persisted into `providerIds[1:]`; the Transcript view shows a
   visible failover indicator (distinct from the existing "pinned" badge) on any node where AC#4 fired.
6. A node with zero or one `providerIds` entry (today's shape) behaves with **zero observable change**
   — same errors, same events, same timing — and exhausting a longer list still ends in today's honest
   `ProviderResolutionError` / `node_error`, never a silent mock/blank result.
7. Repo providers (`backend/repos/**`) get no failover in this story — explicitly out of scope, not a
   gap QA should chase.

## Testing seams

- AC#1 → `providers/resolution.py` (new order-walking entry point) → unit test (backend, pytest)
- AC#2, AC#3 → `engine.py`'s node-execution loop (peek-first-event boundary around
  `adapter.stream_events(...)`) → unit + integration test (backend, pytest) with a fake adapter that
  raises/errors on the first attempt
- AC#4 → `engine.py` SSE event shape (new field/event) → unit test asserting event content; BDD
  scenario, backend (`pytest-bdd`)
- AC#5 → `PropertiesPanel.tsx` (ordered fallback list control) + `Transcript.tsx` (failover badge) →
  Vitest component tests; Playwright E2E scenario (broken primary connection → run still completes,
  badge visible)
- AC#6 → full backend + frontend regression suites, unchanged assertions
- AC#7 → documentation statement only (`provider-harness-rule.md` update), no test

## Definition of Done

- [ ] Feature code complete and committed (backend + frontend)
- [ ] TDD ledger: RED/GREEN recorded per AC slice (`tdd` skill)
- [ ] BDD: one `.feature` scenario per AC#1-4, `pytest-bdd` (backend) + Vitest `it("<Scenario>")`
      (frontend) named identically to the Gherkin scenario
- [ ] Unit tests written (coverage target ≥ 80% new code; ≥ 90% on the resolution/failover-order
      logic itself, matching this sprint's `secrets.py`/`paths.py` bar for containment-adjacent code)
- [ ] Integration tests passing (engine.py node loop, real SSE event sequence)
- [ ] E2E: Playwright scenario, broken-primary-connection run completes via fallback
- [ ] Mutation: Stryker (frontend files touched) + mutmut (backend files touched), isolated worktree
      only, real number reported — same convention as CHAT-TOOLS-FE this sprint
- [ ] Regression: full backend `pytest` + full frontend `vitest`/`tsc`/`eslint`, zero new failures
- [ ] Smoke: a real (non-mocked) run against at least one on-disk fake/mock adapter pairing exercising
      the actual fallback path end-to-end, evidence captured
- [ ] Documentation updated: `docs/product/provider-harness-rule.md`'s "additional array entries are
      preserved as data, not advertised as automatic failover" line rewritten to describe the real,
      disclosed behavior
- [ ] Security review complete — dispatched via `/security-harness` in addition to the standard SEC
      Gate; specific angle: does trying multiple connections' credentials in sequence create a new
      information-disclosure or timing side-channel, and does a failed connection's error ever leak
      detail about a *different* connection?
- [ ] PO accepted in Sprint Review

## Story Points
8 — multiple domains (async-generator surgery in `engine.py`, resolution-order logic, new SSE event
shape, Studio inspector UI, Transcript badge, docs), non-trivial concurrency/ordering edge cases
(AC#2 vs AC#3's exact boundary).

## Priority
P2 Normal — resilience/quality improvement; today's honest-error behavior is not broken, this makes
it recover automatically where an explicit fallback was authored.
