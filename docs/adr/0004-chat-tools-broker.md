# ADR 0004 — O backend é o broker de ferramentas do chat; aprovação por ação pelo canal do run

Status: Proposto (2026-09-18) · Sprint 2026-09-18 · Stories: `CHAT-TOOLS-CONTRACT`, `CHAT-TOOLS-BE`, `CHAT-TOOLS-FE`
Contrato completo: `.harness/sprint-2026-09-18/story-CHAT-TOOLS-CONTRACT/contract.md` · Threat-model: `threat-model.md` ao lado

## Contexto
O chat mostra o workspace selecionado, mas o modelo responde que não vê o diretório. Até hoje o
sidecar só injeta o nome da pasta no system prompt (`triage.py`) e `SOUL.md` diz que o chat "não
pode agir". Os adapters CLI desabilitam tools de propósito (SEC-1/SEC-5). O usuário quer mãos de
verdade: `/` no composer chegando a leitura de arquivo e execução de comando, cobrindo Ollama/HTTP.

## Decisão
1. **Um broker, no backend.** Novas rotas `/chat/tools/{capabilities,discover,read}` e um loop de
   tool-calls dentro do adapter HTTP. Nenhuma tool no frontend; nenhuma no CLI do provedor.
2. **Exec não é endpoint.** Só acontece dentro de `/execute/direct`, como evento SSE, parado em
   `RunControl.gate` até `POST /execute/{run_id}/control {decision}` — o mesmo mecanismo do nó HITL.
   Ganhamos de graça: stop, timeout, `_kill` da árvore de processos, e auditoria no `ExecutionLog`.
3. **Raiz de confiança única:** `_validated_project_cwd` (Cowork project registrado + existente).
   `sandbox/paths.py` valida pós-`resolve()` (symlinks/junctions seguidos).
4. **Camadas para segredos:** denylist → gate; redação de saída; `scrub_env` no filho. Sem shell.
5. **CLI sem tools neste sprint.** `capabilities.reason = "cli-adapter"`. Preset (`/exec`, `/read`)
   funciona porque é o broker que executa.
6. **Skill ≠ Tool** no menu: inserir texto nunca é rotulado como executar.

## Alternativas rejeitadas
- *Tools no frontend (Tauri fs/shell)*: duplicaria contenção em duas linguagens e não cobriria o loop
  do modelo, que vive no backend.
- *Reativar `--tools` nos CLIs*: reabre SEC-1/SEC-5 (hooks/settings/MCP não confiáveis) por um ganho
  que o preset já entrega.
- *`approval_token` + `POST /chat/tools/exec` standalone* (versão inicial da story BE): segundo
  caminho de execução, sem stop/kill/log integrados. Substituído pela decisão 2.
- *Denylist bloqueante de comandos*: bypassável e frustrante; trocada por rótulo `alto risco` +
  aprovação obrigatória.

## Consequências
- Exec **não é sandbox de SO** (threat-model R6): o produto entrega execução local aprovada com os
  privilégios do usuário; a contenção de caminhos vale para `read`/`cwd`. Dito no card de aprovação.
- Toda decisão de tool carrega `call_id` e é consumida uma vez (409 caso contrário).
- Modo direto precisa persistir log (`DIRECT-HISTORY`) para a auditoria valer no chat.
- Ollama só usa o loop com modelos que suportam function-calling; caso contrário o run degrada para
  texto com `provider-no-tools` explícito.
- Testes obrigatórios além de unit: BDD (features do contrato, `pytest-bdd` + Vitest com nomes
  idênticos), regressão das travas SEC, mutation em `sandbox/` (worktree isolado), E2E com provedor
  fake + Playwright (worktree, portas 8001/3001).

## Futuro (fora deste sprint)
Ponte MCP para adapters CLI: servidor MCP interno expondo os mesmos 3 schemas, passado via
`--mcp-config` mantendo `--strict-mcp-config`, aprovação ainda no broker. Exige threat-model e SEC próprios.
