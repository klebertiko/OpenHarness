# Story CHAT-TOOLS-FE — `/` no chat chama ferramentas reais

Dono: **Claude** (FE). Implementa contra `../story-CHAT-TOOLS-CONTRACT/contract.md` com mocks HTTP
do contrato até CHAT-TOOLS-BE existir; depois integra com o BE real.

As a usuário do chat,
I want digitar `/` e ver comandos, skills e ferramentas do workspace selecionado, e ver o assistente lendo e executando de verdade,
So that o chat tem mãos, e eu vejo e aprovo o que ele faz.

## Acceptance Criteria
1. `chatCommands.ts` passa a ter `kind: "Command" | "Skill" | "Tool"`; itens `Tool` vêm de
   `GET /chat/tools/discover` para o workspace selecionado, não de lista fixa.
2. Selecionar uma `Skill` continua inserindo draft editável (comportamento atual preservado) e o
   menu rotula isso como "inserir", nunca como "executar".
3. Quando o assistente pede `read`/`exec`, a Transcript mostra um card com caminho/comando, e
   `exec` exibe botão de aprovação; nada roda antes do clique (token do contrato).
4. Resultado de tool (saída, truncamento, timeout, 403) aparece no card com o estado correto.
5. Sem workspace selecionado, itens `Tool` não aparecem e o composer mostra por quê.
6. `SOUL.md` deixa de dizer que o chat "não pode agir"; descreve capacidades por provider.

## Testing seams
- AC#1 → `chatCommands.ts` → unit (Vitest) com discover mockado
- AC#2 → `ChatComposer.test.tsx` → unit: label e ação de Skill inalteradas
- AC#3/4 → `Transcript.tsx` novo `ToolCard` → unit por estado (pending/approved/ok/403/timeout/truncated)
- AC#5 → `ChatComposer.test.tsx` → unit sem workspace
- AC#6 → revisão TW do `SOUL.md`

## Definition of Done
- [ ] Código + testes commitados; RED/GREEN no ledger por AC
- [ ] `npx vitest run --run` e `npx tsc --noEmit` verdes (saída real)
- [ ] Integração manual contra BE real em dev server isolado, com screenshot no ledger
- [ ] QA fresh-context; ARCH; SEC (fluxo de aprovação é superfície de segurança)
- [ ] PO accepted in Sprint Review

## Story Points
5

## Priority
P0
