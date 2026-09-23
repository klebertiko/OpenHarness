# Ledger — CHAT-TOOLS-FE

## 2026-09-18 02:05 START (claude, FE)
- Contrato: ../story-CHAT-TOOLS-CONTRACT/contract.md v1.1. Cenários: features/chat-tools-menu.feature (13).
- Seams → AC: AC#1 chatCommands.ts + novo lib/chatToolsApi.ts (capabilities/discover) · AC#2 ChatComposer
  (rótulo "inserir") · AC#3/4 ToolCard em agent-run/Transcript.tsx + runReducer (tool_approval_required,
  tool_approval_decision, tool_denied, tool_result.simulated) + runClient.sendControl(call_id) ·
  AC#5 composer sem workspace · AC#6 SOUL.md.
- Também nesta story (PEDIDO Codex 01:34): consumir `source: direct|harness` e `status: failed` no histórico.
- Ordem: fatia 1 (AC#1) → 5 → 2 → 3/4 → 6. Cada fatia RED→GREEN aqui.

## 2026-09-18 02:12 Fatia 1 — AC#1, AC#2, AC#5 (claude)
- RED: chatCommands.test.ts (8) + 4 cenários novos em ChatComposer.test.tsx → 11 failed, 1 vacuous pass.
- GREEN: lib/chatToolsApi.ts (capabilities/discover/read; exec deliberadamente ausente — contrato §0.2),
  chatCommands.ts (kind Tool, hint inserir/executar, preset, loadDraft, splitArgv sem shell),
  ChatComposer.tsx (prop tools/onPreset, nota "Selecione uma pasta…", /exec e /read com argumentos,
  aviso quando há operador de shell). Cenários BDD com nome literal: "Typing slash shows Command,
  Skill and Tool sections", "Selecting a Skill inserts a draft and never executes", "Selecting a
  Tool starts a run with a preset", "No workspace hides tools and says why".
- Verificação (saída real): vitest 2 files 20 passed; suíte inteira 64 files 331 passed / 1 failed
  (Dossier.test.tsx credential-length, pré-existente = story DOSSIER-CRED-LENGTH); tsc --noEmit limpo
  após remover flag /s de regex (target < es2018).
- Não feito ainda: AgentStage não passa `tools`/`onPreset` (fatia 3); ToolCard/aprovação (fatia 2).

## 2026-09-18 02:30 Fatias 2 e 3 — AC#3, AC#4, AC#6 + wiring (claude)
- RED: ToolCard.test.tsx (4 cenários literais do menu.feature) + 6 testes em runReducer.test.ts +
  useChatTools.test.tsx (4) → arquivos falharam na coleta (módulos inexistentes) = RED registrado.
- GREEN: types.ts (ToolCall estendido: origin/argv/path/approval/denied/truncated/timedOut/simulated/
  redactions/exitCode; ToolCapabilities; RunState.capabilities), runReducer.ts (tool_approval_required
  → status gate; tool_approval_decision; tool_denied; tool_result campos novos; capabilities + avisos
  honestos por reason), runClient.ts (DirectRunPayload.tools, sendControl.call_id), useRunStream.ts
  (start.tools, resolveToolCall), ToolCard.tsx (argv em lista, "execução local, com os seus
  privilégios", alto risco + hints, Aprovar/Rejeitar com call_id, um envio só, estados aprovado/
  rejeitado/timeout/saída truncada/simulado), Transcript.tsx (ToolRow delega ao ToolCard),
  useChatTools.tsx (capabilities+discover por workspace/conexão; erro → sem tools, sem throw),
  AgentStage.tsx (tools/onPreset; preset abre run com instruction "" + tools.preset, summarize false),
  SOUL.md (AC#6: capacidades por provider em vez de "no hands").
- Verificação (saída real): ToolCard+reducer 17 passed; suíte 67 files 345 passed / 1 failed
  (Dossier pré-existente); tsc --noEmit limpo.
- Pendente nesta story: (a) histórico `source`/`failed` (PEDIDO Codex 01:34) em RunsPanel/
  HistoricalRunDetail; (b) cenário "First read on a remote provider discloses where content goes"
  (precisa de residence da conexão no reducer — adiado, registrar como gap ou fatia 4);
  (c) integração manual contra BE real — só quando Codex fechar exec/discover/loop; (d) mutation
  (Stryker) e E2E (Playwright) em worktree, depois de (c); (e) QA/ARCH/SEC fresh-context após reset.
- Nota de implementação: `tool_call` do backend hoje manda `args` como string (base.py); o reducer
  aceita string JSON ou objeto. Todos os eventos de tool precisam de `node_id` (como os existentes).

## 2026-09-18 02:40 Fatia 4 — histórico direto (PEDIDO Codex 01:34)
- RED: runsApi.test "keeps source and the failed status" + RunsPanel.test "tells a direct chat turn
  apart…" → 3 failed (o teste antigo do painel também caiu: status "failed" fora do mapa STATUS).
- GREEN: runsApi.ts (RunStatus + "failed", RunSource, normalize lê `source`), RunsPanel.tsx
  ("Direct chat", "Direct · Failed · 3s"). 3 files 11 passed; tsc limpo.

## 2026-09-18 03:09 Fatia 5 — cenário adiado "First read on a remote provider discloses where content goes"
- RED: `readDisclosure.test.ts` (novo, 4 testes) + `ToolCard.test.tsx` it("First read on a remote provider discloses where content goes") → 2 files failed, `Failed to resolve import "./readDisclosure"`.
- GREEN: `readDisclosure.ts` (função pura `readDisclosure(connection, call)` → "arquivos lidos são enviados a <provider>" só para read com resultado em conexão não-local; store zustand `useReadDisclosureStore` = memória de sessão por provider, não persistida), `ToolCard.tsx` (prop `connection`, primeiro card reivindica a frase e marca o provider; cards seguintes não repetem), `Transcript.tsx` ToolRow resolve a conexão do composer via `pickChatProvider(...).id` → `connections.find`.
- Verificação (saída real): 2 files 9 passed; `npx vitest run --run` 68 files 359 passed (359); `tsc --noEmit` exit 0 após corrigir tipo (ChatProvider ≠ Connection).
- Nota: a conexão usada é a do composer (o cenário diz "the selected connection"); um nó com pin diferente ainda não é considerado — gap conhecido, registrar para QA.
03:13 | E2E real (worktree 1420↔8001) | 'No workspace hides tools and says why': PASS — '/' sem pasta mostra a nota 'Selecione uma pasta para usar ferramentas' e só itens Command (find + screenshot). Nota: frontend do worktree roda na 1420 (origem Tauri já na allowlist CORS do backend), não 3001 — 3001 dava preflight 400 e backend não é editável.
- 03:2x | E2E real (1420↔8001, projeto Cowork "E2E tools" criado via API no DB do worktree; "Ollama local" do worktree apontado por PUT para provedor fake OpenAI-compatível em 127.0.0.1:8765, script no scratchpad) | 'Typing slash shows Command, Skill and Tool sections': PASS — a11y tree: Command "/new", Skill "/skill:harness" (E2E fixture skill · claude-skills · insert as an editable draft), Tool "/exec npm run test" (package-scripts), Tool "/read README.md", Tool discover. GAP p/ QA: o .feature diz Skill "labelled inserir"; a UI escreve "insert as an editable draft" (inglês). Não alterado nesta fatia.
- Nota de ambiente: o picker de provedor do chat lista só as conexões-template do providerStore do FE; uma conexão nova criada só no backend ("e2e-local") não aparece. Por isso o fake foi ligado à "Ollama local". Possível gap de produto (conexões criadas fora dos templates) — registrar para PO/QA, fora do escopo desta story.
## 2026-09-21 — Hotfix PEDIDO URGENTE 03:29

Seams TDD:

| AC | Seam | Teste |
|---|---|---|
| New chat preserva histórico, limpa o run anterior e deixa composer vazio | `RunController.reset()` + reação de `AgentStage` a `activeThreadId === null` | `useRunStream.test.ts`, `AgentStage.test.tsx` |
| Tipo de nó desconhecido nunca quebra o transcript | render público de `<Transcript>` | `Transcript.test.tsx` |

**TDD slice — New chat**
- RED: `useRunStream.test.ts` → `reset is not a function`; depois `AgentStage.test.tsx` → reset esperado 1 vez, recebido 0.
- GREEN: `RunController.reset()` invalida a geração, aborta o stream, limpa `RunState`, elapsed e active run; `AgentStage` o chama quando `activeThreadId` vira `null` e foca o composer.

**TDD slice — tipo desconhecido**
- RED: `Transcript.test.tsx` → React `Element type is invalid` em `SegmentView`.
- GREEN: fallback `ROLE_ICON.agent` + `var(--ink-faint)` no marker/header.

Verificação direcionada: 3 files / 36 tests passed; `tsc --noEmit` exit 0.

## 2026-09-22 — integração final, regressão e mutation

- RED integração: selecionar o preset `package-script` com Harness ligado enviava `/execute/`, sem
  passar pelo broker nem abrir aprovação. GREEN: `useRunStream` usa o broker direto quando existe
  `tools.preset`, mesmo com Harness ligado.
- RED E2E: o backend emitia `tool_approval_required`, mas o card ficava recolhido sob “Show run
  detail”. GREEN: `AgentStage` abre o detalhe automaticamente enquanto há aprovação pendente.
- Testes reforçados: contrato completo de Command/Skill/Tool, matriz de estados do `ToolCard`,
  normalização/deduplicação no reducer e defaults de aprovação. Regressão frontend: **68 files / 369
  tests passed**; `tsc --noEmit` exit 0.
- Playwright real em cópia isolada: **3 passed in 26.1s** — menu sem workspace; New chat preserva
  histórico e foca composer vazio; preset `package-script` chama `/execute/direct`, mostra aprovação,
  aceita a decisão e renderiza o resultado.
- OHM real no browser da cópia isolada: import → download → reimport → download passou, com objetos
  autorais iguais; sidecar HTTP stubado.
- Stryker isolado, limitado aos hunks comportamentais da story e ao `rollup.ts`: **386 mutants**, 306
  killed, 54 survived, 26 no coverage; **79,27% total** (covered 85%), threshold 70, exit 0.
  Por arquivo: `chatCommands` 90,91%; `runReducer` 83,97%; `ToolCard` 67,59%; fallback de
  `Transcript` 33,33%; `rollup` 100%. Uma execução diagnóstica de arquivos inteiros deu 38,36% por
  incluir JSX/estilos e código anterior à story; esse número não foi usado como gate. Relatório:
  `D:\Development\.worktrees\openharness-fe-integration-20260918\frontend\reports\mutation.json`.
