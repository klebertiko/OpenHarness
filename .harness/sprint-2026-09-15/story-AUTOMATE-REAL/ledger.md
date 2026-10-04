# AUTOMATE-REAL — estado verificado 2026-09-18 (Codex)

Checkpoint da implementação anterior; a autoria histórica e as regras de arquivos da story foram substituídas pelo sprint-2026-09-18. Fonte detalhada: ../story-AUTOMATE-GAUNTLET/ledger.md §checkpoint técnico Codex.

| AC | Estado |
|---|---|
| 1 registered provider / no mock fallback | Backend básico verificado para manual/harness e cron/direct; sem revisão independente. |
| 2 simulation explícita sem gasto | Backend mock explícito passa; FE ainda chama default live no botão Run simulation. PEDIDO enviado ao Claude. |
| 3 workspace e harness salvos | cwd válido comprovado; casos inválidos sem teste dedicado; possível discrepância bundle manifest vs Harness db; parcial. |
| 4 budget/usage | Harness budget exhausted e mock exempt passam; direct gate existe; precisão medida/parcial failure/unknown price no fluxo automation não demonstradas. |
| 5 histórico e dedup | AutomationRun persiste, mas API/UI não expõem o histórico; dedup só local/sequencial em memória. Parcial. |
| 6 schedule/timezone/enabled | UTC e edição/remoção cron cobertos; sem timezone configurável, enabled ou política de missed runs. Parcial. |

Teste novo tests/test_scheduler_real_execute.py nasceu verde e demonstra execução real usando provider fake só na fronteira externa. Suite Automate: 58 passed in 2.17s. Mutação always-mock: 2 failed, 1 passed in 1.55s (detectada); execução em worktree isolado, fonte restaurada.

BLOCKED: conclusão da feature exige fechar gaps descritos no checkpoint; crítica, QA/ARCH/SEC independentes pendentes até reset combinado. Não é entrega pronta nem aprovação.
