# Ledger — CONTEXT-GAUNTLET-R2

Round 2 da peça 4 de `../../sprint-2026-09-15/story-CONNECTION-CONTEXT-GAUNTLET/ledger.md`.
Bar: DeepSeek Harness Token Meter (`baseline.kind: 'usage' | 'estimated'`). Gap da rodada 1
(crítico `p4-critic-r1`): o rollup prefere o total medido pelo backend silenciosamente, sem
sinal tipado nem visível de qual fonte produziu o número na tela.

## AC → seam → teste

| AC | Seam | Arquivo de teste |
|---|---|---|
| 1 | `rollupTotals(run, liveElapsed)` em `rollup.ts` devolve `{ elapsedMs, tokens, source }`, `source: "measured" \| "estimated"` | `rollup.test.ts` |
| 2 | `RunRollup` (via `<Transcript>`) renderiza o label de proveniência e o troca quando `harness_done` chega | `Transcript.test.tsx` |
| 3 | `rollupElapsedMs` continua devolvendo `null` sem dados; `rollupTotals` idem (`elapsedMs: null`) | `rollup.test.ts` (testes existentes + 1 novo) |
| 4 | veredito do crítico fresh-context | ledger da story original (após reset 20/09) |

Regra de proveniência (única, a mesma que `rollupElapsedMs` já usa): `measured` quando
`harness_done` já pousou `totals.elapsedMs > 0` no reducer; caso contrário `estimated` (tokens e
relógio ainda somados localmente, sem confirmação do backend). Run encerrado por `error` de stream
sem `harness_done` fica `estimated` — honesto: o backend nunca confirmou.

## Ciclos

- 2026-09-18 02:58 | START | ledger aberto; STATUS + board movidos
- 02:58 | RED AC#1,3 | `npx vitest run src/components/agent-run/rollup.test.ts` → 3 failed / 3 passed (6): os 3 novos `rollupTotals` falham com `rollupTotals is not a function`; os 3 de `rollupElapsedMs` seguem verdes
- 02:59 | GREEN AC#1,3 | `rollupTotals(run, liveElapsed)` → `{ elapsedMs, tokens, source }` em `rollup.ts`; mesmo arquivo → 6 passed (6)
- 02:59 | RED AC#2 | `npx vitest run src/components/agent-run/Transcript.test.tsx` → 3 failed / 7 passed (10): "labels the rollup as measured…", "…as estimated…", "flips the label…" falham com `Unable to find an element with the text: measured|estimated`
- 03:01 | GREEN AC#2 | `RunRollup` em `Transcript.tsx` usa `rollupTotals` e renderiza o label `measured`/`estimated` (ponto `bg-signal` vs `bg-ink-faint`, pulsa só com status running; `title` explica a fonte). Mesmo arquivo → 10 passed (10)
- 03:01 | REGRESSÃO | `npx vitest run --run` → 67 files / 354 passed (354); `npx tsc --noEmit` → exit 0
- 03:01 | CAMADAS | BDD: N/A (story sem `.feature`; seams unitários cobrem os 3 estados). Mutation: pendente, entra no Stryker do worktree da CHAT-TOOLS-FE (`rollup.ts` + `Transcript.tsx`). E2E: N/A (sem interação nova; label é render puro). AC#4 crítico fresh-context: após reset 20/09 05:00
03:02 | VISUAL | localhost:3000 (dev vivo, HMR): run real bloqueado no gate HITL mostrou rollup '— elapsed · 0 tok · 0/9 nodes · • estimated' (label à direita, ponto pulsando). Run rejeitado/encerrado em seguida para não deixar run pendente na 8000.

## 2026-09-22 — camada de mutation concluída

- Stryker isolado em `rollup.ts`: **16/16 mutants killed, 100%**.
- O fallback de `Transcript.tsx` foi medido junto da story CHAT-TOOLS-FE; o gate desta story usa o
  módulo puro `rollup.ts`, que contém toda a regra de proveniência. Relatório bruto preservado em
  `D:\Development\.worktrees\openharness-fe-integration-20260918\frontend\reports\mutation.json`.
- AC#4 permanece reservado ao crítico fresh-context do gate QA/ARCH.
