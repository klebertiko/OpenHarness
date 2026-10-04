# Provider ↔ harness rule (Chat)

Two things, kept separate:

- **Provider** — who answers (account + model): Anthropic, OpenAI, Ollama, …
- **Harness** — how the work is organised: one direct turn, or a graph
  (PO → SM → BE → QA with gates) designed in Studio.

## Chat without a harness ("Direct")

One turn, straight to the model. Uses the **composer chip** provider. Never
mock. If nothing is connected, the composer says "Connect a provider" and the
send button is disabled.

## Chat with a harness selected

The graph is the plan. Each agent/LLM node resolves its provider in this order:

| Precedence | Source | Set by |
|---|---|---|
| 1. Node override | a provider pinned on that node | the harness author, in Studio — travels in the `.ohm` |
| 2. Chat chip | the composer's provider | the person, per session |
| 3. Honest error | neither resolves to a connected provider | run stops, points at the node, links to Providers — never silently swaps |

The chip is the default the whole run leans on; the harness only overrides the
steps whose author chose to pin one. Pins take precedence during graph conversion. The composer currently still
requires an eligible chat connection even when every node is pinned.

## Three places to touch a provider

1. **Providers** page (last nav item) — the roster: add a key, health, allowed
   models, routing. The only place to manage a connection.
2. **Composer chip** — which provider *this chat* leans on. "Auto" (first
   eligible connection: cloud before on-device, with the resolved name shown)
   or a specific connection. A session
   default, persisted (`oh.chat.provider.v1`), not per-thread.
3. **Studio node inspector** — pin a provider to *one step*. A design decision
   baked into the `.ohm`.

## Edge cases

- Switching the chip mid-conversation applies to the **next** message.
- An explicitly picked provider becomes unavailable → the chip retains that
  choice and explains its state. Choose Auto or another connection to change
  routing; no silent substitution.
- Ollama-local chip + a node that pins a cloud model you don't have → error,
  no fallback.
- Ollama-local chip + nodes set to inherit → the whole run is on-device. A
  feature, not a bug.

## Implementation status

- **Level 2 (chip)** — done: `pickChatProvider` + `ChatProviderPicker` +
  `chatProviderStore`. Always live, never mock.
- **Level 1 (per-node override)** — implemented: the inspector authors
  `data.providerIds[0]`. The backend resolves that enabled connection.
  Other agents keep their own pins; unpinned agents inherit the chat choice
  when run in chat. An unavailable pin produces an error.
- **Level 1b (fallback chain)** — implemented (PROVIDER-FAILOVER): the
  inspector's "Connection pin" section can also author `providerIds[1:]`,
  an ordered fallback chain. The backend walks it in order — skipping an id
  that fails to *resolve* (disabled, unknown, missing credential) or whose
  adapter fails on its very first event, before anything is observable for
  it — and commits to the first that actually starts producing output. A
  failure *after* that point is never retried. Whenever a fallback (not the
  primary) served the turn, `node_start`/`node_done` carry a `failover`
  field naming every id tried and rejected first; the Transcript shows a
  badge for it, visually distinct from the plain "pinned" badge, so a
  fallback run is never confused with an ordinary pin and is never silent.
- **Use in chat** — composes the current Studio draft and OHM content into
  the active session, enables the harness, then opens chat. Execution begins
  only when the person sends a message. Studio Run itself does not inherit
  the chat chip.

Selection is not a health check. Backend `enabled` determines eligibility;
`setup` is shown as Not verified, and only `live` is shown as verified.
Configure opens the highlighted connection without selecting it or probing it.
