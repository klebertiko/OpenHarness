# Ledger — CHAT-TOOLS-CONTRACT

## 2026-09-18 START (claude, inline ARCH+SEC)
- Stop-the-Line: AC 1-6, DoD, 3 pts, P0 — ok.
- Seams (spike documental): AC#1/2/4 → contract.md revisado por ARCH; AC#3 → threat-model.md
  revisado por SEC fresh-context (pendente até reset 20/09); AC#5 → §Semântica; AC#6 → ADR.
- TDD aqui = "RED" é a lista de perguntas que o contrato precisa responder (abaixo); "GREEN" é
  cada uma respondida com JSON/regra falsificável.
- Inputs lidos: chatCommands.ts, rotas de execution/cowork/repos, SEC-1/SEC-5 em cli_claude.py.

## 2026-09-18 GREEN (claude)
- RED (perguntas que o contrato tinha de responder): onde vive o exec? quem valida a raiz? como
  aprova? o que o CLI ganha? como Ollama chama tools? o que é skill vs tool? quais limites?
- GREEN: contract.md v1.0 (§0 decisões, §2 endpoints com JSON, §2.6 aprovação via control endpoint
  existente, §3 loop HTTP com schemas, §4 sandbox exato, §7 estratégia de testes).
- threat-model.md: STRIDE por fronteira; árvores "exfiltrar segredo" e "exec sem o usuário saber";
  caminho mais barato restante = fadiga de aprovação (T5) → card de aprovação é requisito SEC.
- ADR 0004 criada. features/: sandbox (11 cenários), exec (13), menu (12) = 36.
- Divergência resolvida: story BE AC#4 (approval_token) → nota de substituição na story.
- Pendências para DoD: SEC fresh-context (checklist em threat-model.md §6) após reset 20/09;
  ARCH review do JSON de exemplo (auto-revisado inline — precisa de olho independente).
- Exit provisório: "Ready for QA" (QA documental: AC#5 legibilidade Command/Skill/Tool).
