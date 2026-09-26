# Story CONTEXT-GAUNTLET-R2 — Rollup distingue medido de estimado

Dono: **Claude** (FE). Round 2 da peça 4 de
`../../sprint-2026-09-15/story-CONNECTION-CONTEXT-GAUNTLET/ledger.md` — fix já especificado lá,
mesmo bar (DeepSeek Harness Token Meter), não redescobrir.

As a usuário vendo o rollup de tokens/tempo da execução,
I want saber se o número ainda está sendo contado localmente ou já foi confirmado pelo backend,
So that eu não tome uma estimativa por medição.

## Acceptance Criteria
1. `rollup.ts` devolve um campo de proveniência (`source: "measured" | "estimated"`) ao lado dos números.
2. `RunRollup` em `Transcript.tsx` mostra o estado visivelmente (label ou tooltip) e muda quando o
   total do backend chega.
3. Sem dados, continua mostrando `—`/null — nunca zero fabricado (contrato existente de `rollupElapsedMs`).
4. Crítico fresh-context, mesmo bar da rodada 1, registra veredito no ledger da story original.

## Testing seams
- AC#1 → `rollup.test.ts` → unit RED antes do total do backend
- AC#2 → `Transcript.test.tsx` → unit por estado
- AC#3 → teste existente de `rollupElapsedMs` continua verde
- AC#4 → ledger (após reset)

## Definition of Done
- [ ] RED/GREEN no ledger; Vitest + tsc verdes (saída real)
- [ ] Veredito do crítico registrado
- [ ] PO accepted in Sprint Review

## Story Points
2

## Priority
P2
