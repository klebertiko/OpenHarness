# Story AUTOMATE-CHECKPOINT — Confirmar o que o Automate realmente fechou

Dono: **Codex** (BE + crítico). Não é feature: é auditoria do diff não-checkpointado de 17/09
(`../../sprint-2026-09-15/story-AUTOMATE-GAUNTLET/ledger.md`, ~460 linhas, e `story-AUTOMATE-REAL`).

As a HITL,
I want saber quais peças do Automate (1/2/4/6 do gauntlet) estão prontas de verdade,
So that eu não mergeie nem declare pronto o que só a suíte diz que passa.

## Acceptance Criteria
1. Para cada peça 1/2/4/6, o ledger de AUTOMATE-GAUNTLET recebe uma entrada com: arquivos tocados
   (`git diff --stat` real), teste que a cobre, e veredito `pronta | parcial | ausente`.
2. `real_execute` em `automations/scheduler.py`: seleção real/mock coberta por teste que falha se
   voltar a ser sempre mock.
3. Timezone, dedup, budget e cwd das automações: cada um com teste existente apontado, ou marcado
   `sem cobertura` — sem invenção.
4. Peças com veredito `pronta` recebem um crítico fresh-context (gauntlet-loop) e o veredito dele
   entra no ledger.
5. `story-AUTOMATE-REAL/ledger.md` passa a existir com o estado real.

## Testing seams
- AC#1/3/5 → ledgers — revisão SM/PO: nenhuma afirmação sem comando ou arquivo citado
- AC#2 → `tests/test_scheduler_real_execute.py` → unit
- AC#4 → veredito do crítico no ledger (só após reset 2026-09-20)

## Definition of Done
- [ ] Ledgers atualizados; suíte verde com contagem real
- [ ] Crítico rodou nas peças `pronta`
- [ ] PO accepted in Sprint Review

## Story Points
3

## Priority
P1
