# Studio Copilot — implementation plan (2026-10-04)

**Spec (read first):** `docs/superpowers/specs/2026-10-04-studio-copilot-design.md`.
Section numbers below (§) refer to it.

**Base branch:** `feat/provider-redesign-and-cleanup`. Each slice gets its own
branch, `feat/studio-copilot-sN-<slug>`, and its own PR into that base. If S1
has not merged yet, a slice that depends on it stacks on S1's branch.

**Frozen contract, already on this branch:**

- `backend/studio_copilot/catalog.json`
- `backend/studio_copilot/catalog.py`
- `backend/studio_copilot/contract_examples.json`
- `backend/tests/test_studio_copilot_catalog.py`

**Do not edit them in a slice.** If one is wrong, stop and message the
architect.

## Rules for every slice

- **TDD.** Write the listed RED tests first, run them, and see them fail
  (`npm test` in `frontend/`, `python -m pytest` in `backend/`). Then make
  them GREEN. Tests must assert behaviour, not implementation.
- **Gates before the PR:**
  - Backend: `python -m pytest backend/tests -q`.
  - Frontend: `npm test`, `npm run typecheck` and `npm run lint` in
    `frontend/`.
  - Paste the real counts into the PR's Evidence section. Never invented
    numbers.
- **Dependencies.** No new npm or pip dependencies (spec §2.3). Use
  `@xyflow/react`, `zustand`, `lucide-react`, FastAPI and pydantic, which are
  already present.
- **UI.** Follow `design.md` and spec §3:
  - Sentence-case labels.
  - Mono only for machine facts.
  - Mineral teal (`--signal`) only for interactive or live state.
  - 7px controls and 10px cards.
  - No gradients, glows, pills or emoji.
  - Reuse `Panel`, `inputCls`/`textareaCls` patterns, the `t-meta`/`t-title`
    classes and `rounded-control`.
- **File ownership.** Touch only the files your slice owns (table below).
  The only sanctioned overlap is one `app.include_router(...)` line in
  `backend/main.py` (S1 and S4). Whoever merges second keeps both lines.
- **Commits.** End every commit message with
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. End every PR
  body with
  `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
- **Context.** Each slice is sized for one Sonnet agent under 40% context.
  Load only the files listed.

## Waves and ownership

| Wave | Slice | Owner area (exclusive files) | Depends on |
|---|---|---|---|
| W1 | **S1** BE copilot core (offline) | `backend/studio_copilot/{ops,mock_planner,api_models}.py`, `backend/routers/studio_copilot.py`, `backend/tests/test_studio_copilot_{ops,mock_planner,api}.py`, `scripts/build-sidecar.mjs`, `backend/main.py` (1 line) | frozen contract |
| W1 | **S2** FE ops engine + undoable apply | `frontend/src/lib/copilot/*`, `frontend/src/lib/edges.ts`, `frontend/src/store/canvasStore.ts` (+ new tests) | frozen contract |
| W1 | **S4** BE field assist (offline) | `backend/studio_copilot/field_assist.py`, `backend/routers/studio_assist.py`, `backend/tests/test_studio_assist_{offline,api}.py`, `backend/main.py` (1 line) | frozen contract |
| W2 | **S3** FE Copilot panel | `frontend/src/store/copilotStore.ts`, `frontend/src/components/copilot/*`, `frontend/src/app/page.tsx`, `frontend/src/components/canvas/nodes/BaseNode.tsx`, `frontend/src/lib/studio.ts` | S2 (S1 for a real demo) |
| W2 | **S5** FE field assist in the Inspector | `frontend/src/components/sidebar/FieldAssist.tsx` (+ test), `frontend/src/components/sidebar/PropertiesPanel.tsx` | S2 (S4 for a real demo) |
| W2 | **S6** BE live provider path + e2e | `backend/studio_copilot/{llm,extract,prompts}.py`, live branches in `backend/routers/studio_copilot.py` and `backend/routers/studio_assist.py`, `backend/tests/test_studio_{llm,prompts,live_api}.py`, `backend/tests/e2e/test_studio_copilot_e2e.py` | S1, S4 |
| W3 | **S7** FE provider wiring | `frontend/src/components/copilot/ProviderLine.tsx`, `frontend/src/lib/copilot/useAssistProvider.ts`, small edits to `CopilotPanel.tsx` and `FieldAssist.tsx` | S3, S5 (S6 for live) |

How the waves run:

- **W1** runs as three agents in parallel, and **W2** as three agents in
  parallel.
- S6 edits the routers created by S1 and S4, so it starts only after
  both have merged. S3 and S5 touch no backend files.
- **W3** is one agent.

Dependency edges: S2 → S3, S2 → S5, S1 + S4 → S6, S3 + S5 → S7 (S6 is needed only for S7's live demo).

---

## S1 — Backend copilot core (offline planner, validator, endpoint)

**Goal.** `POST /studio/copilot/plan` with `mode: "mock"` returns a valid
`{summary, ops, source: "offline", tokens: 0}` from the rule-based planner.
`ops.validate_ops` passes all 32 golden cases.

**Create:**

- `backend/studio_copilot/ops.py` exposes:
  - `validate_ops(graph: dict, ops: list) -> ValidationResult`, where
    `ValidationResult = {"ok": True, "graph": dict} | {"ok": False, "errors": [{"index": int, "code": str, "message": str}]}`.
  - Plain-dict validation, hand-written so the error codes stay exact
    (no pydantic for ops).
  - Check order and codes exactly per spec §4.3.
  - It works on a deep copy. Refs map to synthetic ids `ref:<ref>` inside
    the working copy.
  - Also export `ERROR_CODES` (a tuple of the 14 codes).
- `backend/studio_copilot/api_models.py` holds the pydantic request models.
  - `PlanRequest`: `message` (1–2000), `history` (≤ 6 items: role
    user/assistant, text ≤ 2000), `graph` (`CopilotGraph`: nodes ≤ 60,
    edges ≤ 120, node `type` str, label ≤ 60, config dict), `mode`
    (`Literal["mock","live","local"]`) and `connection_id` (str | None).
    Use `model_config = ConfigDict(extra="forbid")`.
  - `S4` defines its own `AssistRequest` in its own file, to avoid
    conflicts.
- `backend/studio_copilot/mock_planner.py`:
  `plan_offline(message: str, graph: dict) -> dict` (summary + ops), per
  spec §5.4.
  - The new agent `systemPrompt` uses the offline draft template from S4.
    Copy the literal template string into a module constant
    `OFFLINE_AGENT_PROMPT`; S6 may dedupe later.
  - Template:
    `"You are the {label} agent.\nGoal: {goal}\n\nHow to work:\n- Stay within this goal; ask for missing inputs instead of guessing.\n- Keep output concise and structured.\n\nHand-off: finish with a one-line verdict for the next step ({next})."`
  - `goal` is the role's default. These are pinned:
    - Planner: "Break the request into ordered, checkable steps."
    - Researcher: "Collect relevant, cited facts for the task."
    - Writer: "Produce the requested draft from the inputs."
    - Reviewer: "Review the previous output and list concrete fixes."
    - QA: "Verify the work against its acceptance criteria."
    - Security: "Check the work for security risks and leaked secrets."
  - `next` is the label of the next node in the chain, or "the next step".
  - Gates get `checklist` set to `"- {Agent} verdict is pass\n- Evidence is attached for every item\n- No open blocker remains"`.
- `backend/routers/studio_copilot.py`:
  `router = APIRouter(prefix="/studio/copilot", tags=["studio-copilot"])`,
  with `POST /plan`.
  - **Body cap.** `int(request.headers.get("content-length", 0)) > 262144`
    → 413 `{"error": "payload_too_large"}`.
  - **Graph cap.** Pydantic errors on the node/edge caps also map to 413.
    Other validation errors → 400 `{"error": "invalid_argument"}`. Use a
    `RequestValidationError`-free approach: accept `dict` and call
    `PlanRequest.model_validate` inside a try.
  - **Mock mode.** `mode == "mock"` → `plan_offline`, then `validate_ops`.
    An invalid offline plan is a bug: return 500 and let tests catch it.
    Then return `{summary, ops, source: "offline", tokens: 0}`.
  - **Other modes** → 501 `{"error": "live_not_ready"}`. S6 replaces this.
- `backend/tests/test_studio_copilot_ops.py`, `test_studio_copilot_mock_planner.py`
  and `test_studio_copilot_api.py`.

**Modify:**

- `backend/main.py`: import and `app.include_router(studio_copilot_router)`
  after `chat_tools_router`.
- `scripts/build-sidecar.mjs`: add
  `"--add-data", \`${join(root, "backend", "studio_copilot", "catalog.json")}${separator}studio_copilot\``
  next to the oharness lines.

**RED tests first:**

1. Parametrised over `contract_examples.json` cases.
   - `ok` cases: `result["ok"] is True`, and the node/edge counts match.
   - Error cases: `errors[0]` has the expected `index` and `code`.
2. `validate_ops` never mutates its input graph (deep-equal before and after).
3. `graph_limit`: a 59-node base graph plus 2 `addNode` → index 1,
   `graph_limit`.
4. Planner, for each of the 3 starter prompts (spec §3.2) plus
   "Research → write → review flow, with human approval at the end", on an
   empty graph and on the golden base graph:
   - the output passes `validate_ops`
   - the summary starts with `Offline draft (rule-based, no model):`
   - all new agents have non-empty `systemPrompt`.
5. Planner: "pesquisar, escrever e revisar com aprovação humana" yields
   Agents Researcher, Writer and Reviewer plus HITL Approval, in that order,
   chained.
6. Planner: "hello" yields `ops == []`, with a summary asking for steps.
7. API: mock happy path 200 with the shape above. `mode: "live"` → 501.
   An oversized message → 400 `invalid_argument`. 61 nodes → 413. Extra
   top-level key → 400. No token → 401, already enforced by middleware:
   assert it once.

**Acceptance.**

- All RED tests are green and the full backend suite is green.
- `curl` with the sidecar token returns an offline plan.

---

## S2 — Frontend ops engine and undoable apply

**Goal.** A pure, tested TS library that serializes the canvas, validates
ops (golden-parity with S1), materialises them with layout, describes and
marks them, plus a `canvasStore` API that applies a patch as exactly one undo
step. Nothing is user-visible yet.

**Create** (exports are a frozen interface for S3, S5 and S7; keep these
names and signatures):

- `frontend/src/lib/copilot/catalog.ts` exports:
  - `CATALOG_TYPES` (`["agent","gate","hitl","skill","mcp","tool"] as const`)
    and `type CatalogType`
  - `EDITABLE: Record<CatalogType, string[]>`
  - `ASSISTABLE: Partial<Record<NodeType, ("systemPrompt"|"checklist")[]>>`
  - `LIMITS` (same keys and values as `catalog.json` → `limits`)
  - `buildCatalog()`, which returns the same shape as `catalog.json` minus
    `_source`, built from `PORTS` + `NODE_TEMPLATES` + `EDITABLE` +
    `ASSISTABLE` + `LIMITS`.
- `frontend/src/lib/copilot/contract.ts` holds the types:
  - `CopilotGraph`, `Op` (discriminated union per spec §4.2),
    `CopilotPlan`, `PlanRequest`, `PlanResponse`
  - `AssistRequest`, `AssistResponse`, `AssistField`, `AssistAction`
  - `CopilotErrorCode` (union of the 14 codes)
  - `ApiErrorBody = { error: string; detail?: string; errors?: {index:number;code:string;message:string}[] }`
- `frontend/src/lib/copilot/serialize.ts`:
  `toCopilotGraph(nodes: HarnessNode[], edges: HarnessEdge[]): CopilotGraph`.
  It uses the allowlist (spec §4.1), drops empty strings and empty arrays,
  normalises handles with `findPort(type, side, handle).id`, and sends
  `decision` nodes with label only.
- `frontend/src/lib/copilot/ops.ts` exports:
  - `validateOps(graph: CopilotGraph, ops: unknown[]): { ok: true; graph: CopilotGraph } | { ok: false; errors: { index: number; code: CopilotErrorCode; message: string }[] }`
    (same semantics as S1)
  - `materializeOps(nodes: HarnessNode[], edges: HarnessEdge[], ops: Op[], opts?: { newId?: () => string }): { nodes: HarnessNode[]; edges: HarnessEdge[]; refToId: Record<string,string> }`
    (assumes already validated; layout per spec §4.4)
  - `describeOps(ops: Op[], graph: CopilotGraph): { glyph: "+"|"~"|"−"|"→"|"×"; text: string; nodeId?: string }[]`
  - `diffMarks(before: HarnessNode[], after: HarnessNode[]): Record<string, "added"|"changed">`
    ("changed" = label or any editable field differs)
- `frontend/src/lib/copilot/api.ts` exports:
  - `planGraphEdit(req: PlanRequest, signal?: AbortSignal): Promise<PlanResponse>`
  - `assistField(req: AssistRequest, signal?: AbortSignal): Promise<AssistResponse>`
  - `class CopilotApiError extends Error { status: number; body: ApiErrorBody }`

  It calls `fetch(apiUrl("/studio/copilot/plan" | "/studio/assist/field"), {method:"POST", headers JSON, body, signal})`,
  following `lib/chatToolsApi.ts`'s `request` pattern.
- `frontend/src/lib/copilot/testGraph.ts`, a test-only helper.
  `goldenBaseCanvas(): { nodes: HarnessNode[]; edges: HarnessEdge[] }`
  converts `contract_examples.json` → `baseGraph` into canvas nodes with
  pinned positions: a1 `(0,0)`, g1 `(280,0)`, h1 `(560,0)`, s1 `(0,160)`.
  Edges go through `edgeForConnection`. S3's tests reuse it.
- `frontend/src/lib/edges.ts`:
  `edgeForConnection(source: HarnessNode | undefined, c: { source: string; target: string; sourceHandle?: string|null; targetHandle?: string|null }): HarnessEdge`.
  This is the decoration logic moved out of `canvasStore.onConnect`. It
  returns `type: "harness"`, `data: {kind, label}`, and the id
  `e-${source}-${sourceHandle}-${target}-${targetHandle}` with handles
  normalised.

**Modify `frontend/src/store/canvasStore.ts`:**

- `HistoryEntry` gets `seq: number`. The store keeps `_seq`, incremented on
  every `pushHistory`.
- New actions on `CanvasState`:
  - `checkpoint(): void` pushes only if
    `JSON.stringify({nodes, edges}) !== JSON.stringify(head)`, ignoring
    `seq`.
  - `applyGraphPatch(nodes: HarnessNode[], edges: HarnessEdge[]): number | null`
    returns `null` if `isRunning`; otherwise it calls `checkpoint()`, sets
    nodes and edges (each edge `type: "harness"`), calls `pushHistory()`,
    and returns the new head `seq`.
  - `commitNodeData(nodeId: string, patch: Partial<NodeData>): void` calls
    `checkpoint()`, then `updateNodeData`, then `pushHistory()`. It is a
    no-op while running.
  - `headSeq(): number`.
- `onConnect` uses `edgeForConnection`. Keep `addEdge`'s duplicate guard by
  checking for an existing edge with the same id before appending.
- Existing tests (`canvasStore.test.ts`, `canvasStore.authoring.test.ts`)
  must stay green unchanged.

**RED tests first** (new files: `lib/copilot/ops.golden.test.ts`,
`catalog.parity.test.ts`, `serialize.test.ts`, `ops.materialize.test.ts`,
`ops.describe.test.ts`, `api.test.ts`, `lib/edges.test.ts`,
`store/canvasStore.copilot.test.ts`):

1. **Golden.** Read `../../../../backend/studio_copilot/contract_examples.json`
   via `node:fs` + `path.resolve(__dirname, ...)`. All 32 cases match
   `index`/`code`, or the counts for `ok` cases.
2. **Parity.** `buildCatalog()` deep-equals `catalog.json` without
   `_source`.
3. **Serialize.** A node carrying `secretRef`, `apiKey`, `endpoint`,
   `mcpCommand`, `mcpUrl`, `providerIds`, `output`, `status` and `model`
   serializes with none of those keys. `JSON.stringify` of the result does
   not contain the secret values. A null `sourceHandle` on a gate edge
   becomes `"pass"`.
4. **Materialize:**
   - `add_and_wire` on the golden base graph with `newId` → `"x1"` creates
     `agent-x1` with template defaults (`adapter: "mock"`) merged with the
     config. Its anchor is `near: g1`, so the base position is `(560, 0)`.
     That collides with h1, so it moves down one row to `(560, 120)`.
   - The `fail` edge has `data.kind === "reject"` and label `"fail"`.
   - Collision: two new nodes anchored on the same node stack 120px apart.
   - A skill anchored on a fresh agent at `(1000, 0)` goes to
     `(1000, 160)`.
   - On an empty graph, the first node goes to `(0, 0)`.
5. **Describe.** `add_and_wire` gives lines with glyphs `+`, `→`, `→`. The
   texts quote labels, e.g. `Agent "Reviewer"`, and never raw ids for
   existing nodes.
6. **Store undo:**
   - Edit a node via `updateNodeData`, which pushes no history, then
     `applyGraphPatch`, then `undo()`. The state equals the post-edit,
     pre-patch graph: the edit survives.
   - `applyGraphPatch` returns a seq equal to `headSeq()`. After another
     `addNode`, `headSeq()` differs.
   - While running, it returns `null` and the state is unchanged.
   - `commitNodeData` followed by `undo()` restores the old field value.
7. **Store trim.** After 60 pushes, a seq taken before the last push no
   longer equals `headSeq()`, even though the index is still 49.
8. **API.** `planGraphEdit` POSTs JSON to `/studio/copilot/plan`. A non-OK
   response throws `CopilotApiError` with status and parsed body. An abort
   propagates as `AbortError`.
9. **`edgeForConnection`.** A hitl `reject` handle → `kind "reject"`,
   label `"reject"`. An agent `out` handle → `kind "flow"`, no label.

**Acceptance.**

- All new tests and the existing suite pass. `typecheck` and `lint` are
  clean.
- No UI change.

---

## S4 — Backend field assist (offline)

**Goal.** `POST /studio/assist/field` with `mode: "mock"` returns
deterministic draft, improve and review output per spec §5.1 and §5.4.

**Create:**

- `backend/studio_copilot/field_assist.py`, with
  `AssistRequest` (pydantic, `extra="forbid"`, limits per spec §5.1) and
  `assist_offline(req: AssistRequest) -> {"text": str|None, "notes": list[str]}`.
  **The output is pinned** (tests assert it exactly):
  - **draft, agent `systemPrompt`:** use the same literal template string
    as S1's `OFFLINE_AGENT_PROMPT`, copied here because S1 and S4 run in
    parallel (S6 may dedupe). Fill it with
    `{label}` = node label, `{goal}` = `intent.strip()` with a trailing
    period added if missing, and `{next}` = the comma-joined labels of
    `direction=="out"` neighbours or "the next step". Notes:
    `["Drafted offline from your intent — edit freely."]`.
  - **draft, skill `systemPrompt`:**
    `"Skill: {label}\nDoes: {goal}\n\nInputs: what the calling agent provides.\nOutput: a short result the agent can use directly.\nUse when: an agent needs exactly this capability."`
  - **draft, gate `checklist`:**
    `"- {goal}\n- Evidence is attached for every item\n- No open blocker remains"`.
  - **improve:**
    - Strip each line, collapse 3 or more newlines to 2, and trim.
    - For an agent or skill without a line starting `Goal:` or `Does:`,
      prepend `"Goal: {focus or 'State the goal here.'}\n"`.
    - For a checklist, prefix non-bullet non-empty lines with `"- "`.
    - The notes list each change applied, using the pinned strings
      `"Normalised spacing."`, `"Added a Goal line."` and
      `"Turned lines into checklist items."`, or `["Already tidy."]` when
      nothing changed.
  - **review** (`text: None`) runs these rules in order and keeps at most 5
    notes:
    1. `len(current.strip()) < 80` → "Too short to guide a model — say what
       good output looks like."
    2. No match of `(?i)hand-?off|verdict|emit|signal|done when|finish` →
       "Doesn't say how to finish or what to hand off."
    3. Agent with no match of `(?i)\byou are\b|\brole\b` → "Doesn't state
       the role."
    4. Checklist with fewer than 2 non-empty lines → "A gate checklist needs
       at least two checkable items."
    5. `sandbox.secrets.redact(current)[1] > 0` → "Contains something that
       looks like a secret — remove it."
    6. If nothing matched → `["Looks complete."]`.
- `backend/routers/studio_assist.py`:
  `APIRouter(prefix="/studio/assist", tags=["studio-assist"])`,
  `POST /field`.
  - The 413 and 400 mapping matches S1 (re-implement the small helper
    locally; do not import S1's router).
  - A field not in `catalog.assistable_fields(node.type)` → 400
    `{"error": "field_not_assistable"}`.
  - `draft` with an empty `intent` → 400 `invalid_argument`.
  - Mock → `{**assist_offline(req), "source": "offline", "tokens": 0}`.
  - Live or local → 501 `live_not_ready`.
- Tests: `backend/tests/test_studio_assist_offline.py` and
  `backend/tests/test_studio_assist_api.py`.

**Modify:** `backend/main.py`, one `include_router` line (see the overlap
rule).

**RED tests first:**

1. Each draft variant equals the pinned string exactly, for a fixed input.
2. Improve on `"  You are QA.\n\n\n\nCheck tests. "` gives
   `"Goal: State the goal here.\nYou are QA.\n\nCheck tests."`, with notes
   containing "Normalised spacing." and "Added a Goal line.".
3. Review rules fire individually, and "Looks complete." appears only when
   none fire. A string containing `sk-ant-` + 40 characters triggers the
   secret note: check `sandbox/secrets.py` patterns and use one it
   recognises.
4. API:
   - `field: "checklist"` on an agent → 400 `field_not_assistable`.
   - `draft` with no intent → 400.
   - `current` of 8001 characters → 400.
   - Mock 200 shape.
   - Live → 501.

**Acceptance.** All tests are green and the full backend suite is green.

---

## S3 — Copilot panel (offline end to end)

**Goal.** In the Studio editor, Mod+I opens Copilot. Sending a prompt calls
`planGraphEdit` (mode `"mock"` in this slice; S7 switches it). The client
re-validates and applies one undo step, nodes get badges, and the proposal
card's Keep/Undo work. This slice is fully demoable against the S1 backend.

**Create:**

- `frontend/src/store/copilotStore.ts`, a zustand store, not persisted.
  - State: `open: boolean`, `tab: "inspector" | "copilot"`,
    `turns: Turn[]`, `status: "idle"|"working"|"error"`,
    `marks: Record<string,"added"|"changed">` and
    `abort: AbortController | null`.
  - `Turn = { id: string; role: "user"|"assistant"; text: string; source?: "model"|"offline"; error?: { text: string; retry?: string }; proposal?: { seq: number; lines: ReturnType<typeof describeOps>; state: "open"|"kept"|"undone" } }`.
  - Actions: `openCopilot()` (sets open and tab, and calls
    `useShellStore.getState().setRightOpen(true)`), `close()`,
    `setTab(t)`, `send(text, opts?: {mode?: "mock"|"live"|"local"; connectionId?: string|null})`,
    `cancel()`, `keep(turnId)`, `undo(turnId)` and `reset()`.
- **The `send` flow:**
  1. Auto-keep any open proposal.
  2. Push the user turn and set status to working.
  3. Call `planGraphEdit({message, history: last 6 turns as {role, text}, graph: toCopilotGraph(...), mode, connection_id})`.
  4. On success:
     - Call `validateOps(toCopilotGraph(live canvas), res.ops)`. If it
       fails, record an assistant turn with error "The graph changed while
       Copilot was working" and `retry: text`.
     - If it passes and there are ops: run `materializeOps`, then
       `applyGraphPatch`. A `null` result (a run started) is the same error
       path with the text "Stop the run to apply changes". Otherwise set
       `marks = diffMarks(before, after)` and record the proposal with its
       `seq` and the `describeOps` lines.
     - Push the assistant turn with `res.summary` and `res.source`.
  5. On `CopilotApiError`, map it to human text per spec §3.2 (`detail`
     where present, 402 message, `plan_invalid` text) with `retry: text`.
  6. On `AbortError`, push nothing and return to idle.
- **`keep` / `undo`:**
  - `keep` sets the proposal state to "kept" and clears marks.
  - `undo` calls `canvas.undo()` only if `canvas.headSeq() === proposal.seq`,
    then sets the state to "undone" and clears marks.
  - The `undoAvailable(turnId)` selector exposes that seq check.
- `frontend/src/components/copilot/StudioSidePanel.tsx` has segmented tabs
  (`role="tablist"`, arrow-key navigation) and renders `<PropertiesPanel/>`
  or `<CopilotPanel/>`. The Inspector tab shows "· 1 selected" when a node is
  selected while on the Copilot tab.
- `frontend/src/components/copilot/CopilotPanel.tsx` contains:
  - the transcript, empty state and starter buttons
  - the composer: autosize textarea, Enter/Shift+Enter/Esc, 2000-character
    cap with a counter after 1800, disabled while running or working
  - the `Working · Ns` row and **Cancel**
  - error rows with **Try again**
  - an `Offline draft` tag for offline turns

  It uses the Panel title "Copilot". Text renders as plain text only, never
  through `dangerouslySetInnerHTML` or markdown.
- `frontend/src/components/copilot/ProposalCard.tsx` renders the header,
  lines, **Keep** and **Undo** (disabled with a title when
  `!undoAvailable`), and the collapsed kept/undone states. Clicking a line
  that has a `nodeId` selects the node, switches to the Inspector tab, and
  centres the node via `useReactFlow().setCenter`, the same pattern as
  `GraphAudit`.
- Tests: `store/copilotStore.test.ts`,
  `components/copilot/CopilotPanel.test.tsx`, `ProposalCard.test.tsx` and
  `StudioSidePanel.test.tsx`.

**Modify:**

- `frontend/src/app/page.tsx`:
  - The right slot becomes
    `isStudio && studioView === "editor" && (selectedNodeId || copilotOpen) ? <StudioSidePanel/> : null`.
  - Add a secondary button, "Ask Copilot", in the editor header strip,
    before "Use in chat".
  - Add a command: `{ id: "copilot", label: "Ask Copilot", group: "Studio" /* match existing group naming */, chord: "Mod+I", run: openCopilot }`,
    enabled only in the Studio editor.
- `frontend/src/components/canvas/nodes/BaseNode.tsx`: read
  `useCopilotStore((s) => s.marks[id])`. When set, render
  `<span className="t-meta text-signal">+ new</span>` or `~ edited` in the
  existing meta slot (`StateSlot` area), with the running/error states
  taking precedence. Change nothing else.
- `frontend/src/lib/studio.ts`: `openStudioBundle` calls
  `useCopilotStore.getState().reset()` after `loadGraph`.

**RED tests first** (mock `lib/copilot/api.ts` with `vi.mock`):

1. Store: `send` with a mocked plan, using the golden `add_and_wire` ops
   against a canvas loaded with the golden base graph converted to
   `HarnessNode`s, does three things: canvas node count 4 → 5, the
   proposal's `seq === headSeq()`, and `marks` has the new id as "added".
   `undo(turnId)` then restores 4 nodes and the exact prior edges.
2. Store: after a successful send, a manual `addNode` makes
   `undoAvailable` false, and `undo(turnId)` leaves the canvas untouched.
3. Store: live-graph drift. If the mock resolves after the test has removed
   `g1` from the canvas, nothing is applied and the error turn has a retry.
4. Store: a mock response of `CopilotApiError(422, {error: "plan_invalid"})`
   produces an error turn with "didn't fit the graph rules".
5. Store: `cancel()` aborts, leaves status idle, and adds no assistant turn.
6. Store: sending a new prompt auto-keeps the previous open proposal.
7. `CopilotPanel`: the empty state shows 3 starters. Enter sends and
   Shift+Enter inserts a newline. While working, the row shows "Working"
   and a Cancel button. Offline turns show "Offline draft".
8. `ProposalCard`: renders lines. **Keep** collapses to "Kept 3 changes".
   A disabled **Undo** has the title text from the spec.
9. `StudioSidePanel`: arrow keys switch tabs. Selecting a node while on
   Copilot does not switch tabs.
10. Model text containing `<img src=x onerror=alert(1)>` renders as literal
    text: no `img` element in the DOM.

**Acceptance.**

- Spec §9 item 1 passes manually against the S1 backend: `npm run dev` plus
  the sidecar. Attach 2 screenshots, panel with proposal and after Undo, to
  the PR, saved under `D:\Development\handoffs\studio-copilot-shots\`.
- All gates are green.

---

## S5 — Field assist in the Inspector

**Goal.** Assist (draft/improve/review) works inline for Agent System
Prompt, Skill System Prompt and Gate Checklist. **Use this** is one undo
step. Mode is `"mock"` in this slice; S7 switches it.

**Create `frontend/src/components/sidebar/FieldAssist.tsx`:**

`export function FieldAssist({ nodeId, field }: { nodeId: string; field: AssistField })`
renders the "Assist" toggle button (compact text button, lucide `PenLine`
12px, `aria-expanded`) and the inline row per spec §3.3.

- **Request.** It builds an `AssistRequest` from the canvas: the node's type,
  label and ids, `current` = the field value, and up to 8 neighbours from
  edges, with `direction`, the other node's type and label, and the port.
  `harnessName` comes from `harnessMeta.name`.
- **State.** Local state is `"idle"|"working"|"result"|"error"`, with an
  `AbortController` and elapsed seconds (1 s interval, cleared on unmount).
- **Use this** calls `useCanvasStore.getState().commitNodeData(nodeId, { [field]: text })`.
- **Improve with these** calls improve with
  `focus = notes.join("\n")`.
- **Errors.** Error text is mapped like S3's: `detail`, 402 and
  `assist_invalid`.
- **Running.** The button is disabled while `isRunning`.

**Modify `frontend/src/components/sidebar/PropertiesPanel.tsx`:**

- For the System Prompt textarea, when `node.type` is agent or skill, and
  the Checklist textarea for a gate, render `<FieldAssist>`.
- Placement: the toggle sits right-aligned in the field's label row and the
  row renders below the textarea. Extend `Field` with an optional `action`
  prop for the label-row slot, keeping its existing child-id wiring intact.
- Gate on `ASSISTABLE[node.type]?.includes(field)`. Do not hardcode the
  types.

**RED tests first** (`FieldAssist.test.tsx`, plus a
`PropertiesPanel.fieldAssist.test.tsx`; mock `lib/copilot/api.ts`):

1. An empty agent prompt shows the intent input and **Draft**. Typing an
   intent and clicking Draft calls `assistField` with
   `{field:"systemPrompt", action:"draft", intent, node:{type:"agent",...}, mode:"mock"}`.
   The suggestion renders, **Use this** sets the node's `systemPrompt`, and
   `undo()` restores `""`.
2. A non-empty field shows **Improve** and **Review**. Review renders
   notes, and **Improve with these** sends `focus` with those notes.
3. A gate shows Assist on Checklist. HITL, MCP and Tool nodes show no
   Assist anywhere. An agent shows no Assist on non-prompt fields.
4. **Discard** clears the suggestion without touching the node.
5. Cancel aborts the request, and the row returns to idle.
6. The request never contains `secretRef`/`apiKey`/`endpoint`, even when
   the node has them.
7. Existing `PropertiesPanel.*.test.tsx` files stay green unchanged.

**Acceptance.**

- Spec §9 item 3 passes manually against the S4 backend, with one
  screenshot.
- All gates are green.

---

## S6 — Backend live provider path, prompts and e2e

**Goal.** `mode: "live"|"local"` on both endpoints calls the chosen
connection through the existing resolution, budget and usage chain, with a
JSON extract and one repair round (spec §5.2 and §5.3). Invalid ops are
never returned.

**Create:**

- `backend/studio_copilot/extract.py`:
  `extract_json(text: str) -> dict | None`. It returns the first ```json (or
  bare ```) fenced block that parses to a dict; otherwise the first balanced
  top-level `{...}`, scanning braces and ignoring braces inside JSON
  strings; otherwise `None`.
- `backend/studio_copilot/prompts.py`:
  - `plan_system_prompt() -> str`, built from `catalog.load_catalog()` per
    spec §5.3, points 1–7.
  - `plan_user_message(message, history, graph) -> str`, which wraps
    `<graph>` and `<request>`, truncates text fields to 1500 characters, and
    applies the 24 000-character omission rule.
  - `assist_system_prompt(field, node_type, action) -> str` and
    `assist_user_message(req) -> str`.
  - All outbound text goes through `sandbox.secrets.redact` first.
- `backend/studio_copilot/llm.py` implements
  `async def complete_json(request, db, *, connection_id, system, user, validate, source, timeout_s) -> tuple[Any, int]`
  exactly per spec §5.2.
  - `validate(obj) -> tuple[value | None, error_str | None]`.
  - It raises `HTTPException` with the JSON bodies from the spec table
    (`provider_unavailable`, 402, `provider_error`, `provider_timeout`,
    `plan_invalid`/`assist_invalid` via a `invalid_code` param).
  - **Mirror `/execute/direct`.** Read `routers/execution.py` lines ~455–520
    and the `record_usage` call site around lines 400–440. The `provider=`
    and `residence=` arguments must match how direct runs record usage.
- `backend/tests/test_studio_llm.py`, `test_studio_prompts.py` and
  `test_studio_live_api.py`.
- `backend/tests/e2e/test_studio_copilot_e2e.py`, copying the
  `test_direct_history_e2e.py` scaffolding: a real sidecar subprocess and a
  local fake OpenAI-compatible server. It is skipped unless
  `OH_ISOLATED_E2E=1`.

**Modify** `backend/routers/studio_copilot.py` and
`backend/routers/studio_assist.py`: replace the 501 branch with
`complete_json(...)`.

- **Plan validator:** the parsed object must be
  `{summary: str ≤ 600, ops: list}`, and
  `ops.validate_ops(req.graph, ops)` must pass. Otherwise
  `(None, "<code>: <message>")`.
- **Assist validator:** `{text: str|None, notes: list[str]}`.
  - `text` is required (non-empty, within the field limit) for draft and
    improve, and must be `None` for review.
  - Notes are capped to 5 and each truncated to 200 characters.
- `connection_id` missing in live or local → 400 `provider_unavailable`.

**RED tests first** (`get_adapter` is monkeypatched or a fake connection is
registered; the adapter is a fake `AgentAdapter` subclass returning scripted
contents):

1. `extract_json` handles fenced, prose-wrapped, braces-in-strings, nested
   and no-JSON input, the last returning `None`.
2. Prompts:
   - The plan system prompt contains every catalogue type and its ports.
   - It does not contain "decision" as an allowed type.
   - It contains the data-boundary sentence.
   - The user message wraps `<graph>`/`<request>`, truncates a 2000-character
     prompt to 1500 characters, and redacts an `sk-…` key planted in a
     systemPrompt.
3. `complete_json`:
   - valid on the first try → 1 invoke
   - invalid then valid → 2 invokes, and the second user message contains
     "Your previous reply was rejected"
   - invalid twice → 422
   - `result.error` → 502
   - a slow fake with `timeout_s=0.05` → 504
   - an unknown connection → 400 `provider_unavailable`
   - the budget exceeded (set the limit via `usage_tracking.set_budget_limit`
     and pre-record spend) → 402
   - usage recorded with `source="studio_copilot"` and the summed tokens
4. Live API:
   - The plan returns `source: "model"` with ops that pass validation.
   - Model ops containing `secretRef` are repaired or rejected with 422,
     never returned.
   - Assist review returns `text: null`.
   - The `config.system_prompt` passed to the adapter equals the built
     system prompt, and the temperature is 0.2.
   - The adapter receives `cwd`-free config: assert
     `config.extra.get("cwd") is None`.
5. E2E (opt-in): with a live OpenAI-compatible fixture connection, the plan
   returns 200 and the ops validate, and assist draft returns text. Usage
   rows exist afterwards via `GET /usage/summary`.

**Acceptance.**

- All tests are green and the full suite is green.
- The e2e passes locally with `OH_ISOLATED_E2E=1`; paste the output.
- In the PR, ask SEC to review spec §7.

---

## S7 — Frontend provider wiring (live by default, offline fallback)

**Goal.** Copilot and Assist use the chat's provider: live when one is
ready. They show the `missingProviderAction` text and a **Use offline draft**
fallback otherwise (spec §3.4).

**Create:**

- `frontend/src/lib/copilot/useAssistProvider.ts`:
  `useAssistProvider(): { mode: "mock"|"live"|"local"; connectionId: string|null; provider: ChatProvider|null; missing: {text:string; id:string|null}|null; requestSetup: () => void }`.
  - It is built from `useProviderStore(s => s.connections)`,
    `useChatProviderStore(s => s.chosenId)`, `pickChatProvider` and
    `missingProviderAction`. If lane L1's `providerReadiness` (PR #33) is
    on the base by then, use it and keep the outputs identical.
  - `requestSetup` calls
    `useChatSetupRequestStore.getState().requestSetup(missing.id)` when
    `id` is set; otherwise it opens Providers via `useShellStore`.
- `frontend/src/components/copilot/ProviderLine.tsx` renders
  `Answers with {label} · {chatProviderStatus}` as `t-meta`. A click
  expands `<ChatProviderPicker onConnect={() => setSection("providers")} />`
  inline. With no provider, it renders the `missing.text` button plus a
  secondary **Use offline draft** button.

**Modify:**

- `CopilotPanel.tsx`: render `<ProviderLine/>` at the top. `send` passes
  `{mode, connectionId}` from the hook. With no provider, the composer's
  send is replaced by the `missing.text` action, and **Use offline draft**
  sends with `mode: "mock"`.
- `FieldAssist.tsx`: pass `mode` and `connectionId` from the hook. With no
  provider, it silently uses `"mock"`; the result is tagged by the backend's
  `source`.

**RED tests first:**

1. Hook:
   - a ready cloud connection → `mode "live"` with its id
   - a local connection → `"local"`
   - none → `mode "mock"`, with `missing.text === missingProviderAction(...)!.text`
   - an explicit unavailable choice → `missing.id` equals that id
2. `CopilotPanel` with no provider: no Send button, the missing-provider
   text button is shown, and clicking it calls `requestSetup` with the id.
   **Use offline draft** sends `mode: "mock"`.
3. `CopilotPanel` with a provider: send passes
   `mode: "live", connection_id: <id>`, and the ProviderLine shows the
   label and status word.
4. `FieldAssist` with a provider passes `mode`/`connection_id`, and with
   none passes `"mock"`.

**Acceptance.**

- Spec §9 items 2 and 4 pass manually: a live provider and a disconnected
  state, with 2 screenshots.
- All gates are green.

---

## After S7

- QA runs fresh-context against spec §9.
- ARCH runs the Stage-1 review across the merged slices, checking for drift
  from §4 and §6.
- SEC runs fresh-context on §7, focusing on prompt injection, the
  serializer allowlist and the CLI adapter `cwd`.
- HITL merges.

TW update for `README.md`: one short "Studio Copilot" paragraph under the
Studio section, with no invented metrics.
