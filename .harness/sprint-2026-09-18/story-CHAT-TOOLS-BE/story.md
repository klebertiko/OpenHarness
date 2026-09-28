# Story CHAT-TOOLS-BE — Broker de ferramentas do chat no backend

Dono: **Codex** (BE). Implementa exatamente `../story-CHAT-TOOLS-CONTRACT/contract.md`.

> **Nota do contrato (2026-09-18):** AC#4 abaixo (`approval_token` → 428) está **substituído** por
> `contract.md` §0.2/§2.6 — exec não é endpoint; roda só dentro de `/execute/direct`, parado em
> `RunControl.gate` até `POST /execute/{run_id}/control {decision}`. Seams: `sandbox/exec.py` +
> loop em `adapters/openai_compatible.py`. Cenários: `../story-CHAT-TOOLS-CONTRACT/features/`.
> Contrato publicado em 2026-09-18 — a story está liberada.

As a usuário que selecionou "📁 Development" no composer,
I want que o assistente (Ollama local, HTTP ou CLI) leia arquivos e rode comandos nesse diretório,
So that o chat pare de responder "não tenho visibilidade do diretório" e faça o trabalho.

## Acceptance Criteria
1. `GET /chat/tools/discover?workspace=<root>` lista comandos internos e skills encontrados no
   workspace autorizado (`.claude/skills/*/SKILL.md` e equivalentes), distinguindo `kind` por item.
2. `POST /chat/tools/read` devolve o conteúdo de um arquivo dentro da raiz; caminho fora da raiz ou
   via symlink que escapa → 403 com corpo estruturado, nunca o conteúdo.
3. `POST /chat/tools/exec` roda um comando na raiz com timeout e limite de bytes do contrato;
   estoura timeout → processo morto e status `timeout`; estoura bytes → saída truncada com marcador.
4. `POST /chat/tools/exec` sem `approval_token` válido → 428; o token é emitido por ação, não por sessão.
5. Para Ollama/HTTP o backend orquestra o loop de tool-calls (modelo pede → backend executa →
   resposta volta ao modelo) até resposta final ou limite de iterações do contrato.
6. Para adapters CLI, SEC-1/SEC-5 permanecem: a flag `--tools ""` continua, e o broker é a única
   via de execução (teste garante que a flag não mudou).
7. Arquivos que casem com padrões de segredo (`.env*`, `OH_SECRETS`, chaves) não são lidos por
   `read` sem aprovação explícita adicional.
8. Workspace propagado no intake (`triage.py`) e no direct/harness com a mesma raiz.

## Testing seams
- AC#1 → `backend/routers/chat_tools.py::discover` → unit + integração com fixture de workspace
- AC#2 → `chat_tools.py::read` + `sandbox/paths.py` → unit (traversal, symlink absoluto/relativo)
- AC#3 → `chat_tools.py::exec` → integração com comando que dorme e comando que imprime 10MB
- AC#4 → `chat_tools.py::exec` → integração 428 sem token, 200 com token de uso único
- AC#5 → `adapters/http_*.py` loop de tools → unit com modelo fake que pede 2 tools e responde
- AC#6 → `tests/test_cli_claude_flags.py` → unit (flag inalterada)
- AC#7 → `sandbox/secrets.py` → unit
- AC#8 → `triage.py` + `routers/execution.py` → integração: raiz idêntica nas duas rotas

## Definition of Done
- [ ] Código + testes commitados; RED/GREEN no ledger por AC
- [ ] Suíte backend inteira verde (contagem real da saída do pytest, não copiada)
- [ ] `contract.md` atualizado se algo divergiu — divergência sem atualização é bounce do ARCH
- [ ] QA e SEC fresh-context (depois do reset) — SEC é obrigatório: toca execução e segredos
- [ ] PO accepted in Sprint Review

## Story Points
8

## Priority
P0
