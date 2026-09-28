# AUTOMATE-CHECKPOINT — ledger (Codex)

## 2026-09-18 — START / seams

Auditoria, sem ampliar feature. Ledger AUTOMATE-GAUNTLET lido integralmente em blocos; story AUTOMATE-REAL lida. O ledger termina na dispatch Wave 1; não contém uma entrega final do builder backend. O código presente é a evidência primária.

- AC#1/3/5: diff e leitura de backend/automations/scheduler.py, models.py, routers/automations.py, main.py; testes existentes e ledgers citados.
- AC#2: novo tests/test_scheduler_real_execute.py, observando resolver/adapter através de run_job e scheduler.tick. Fake somente no provider externo; SQLite temporário.
- AC#4: crítico fresh-context pendente até reset combinado, nunca substituído por este parecer técnico.
- BDD: cenários Given/When/Then nos testes de seleção. Mutation dirigida à seleção real/mock em worktree. E2E visual N/A para auditoria; gaps de fluxo serão informados, não corrigidos silenciosamente.

Diff-base HEAD 3689da0; working tree sem commit, compartilhado. `git diff --stat -- backend/automations/ backend/models.py backend/routers/automations.py backend/main.py backend/tests/test_scheduler.py backend/tests/test_cowork_automations_api.py`: 6 files changed, 892 insertions(+), 30 deletions(-). Esse total inclui outras alterações anteriores (provider/usage), não é atribuído só ao Automate.

## Checkpoint AC#1/2/3/5
Relatório por peça e matriz de cobertura anexados em sprint-2026-09-15/story-AUTOMATE-GAUNTLET/ledger.md, seção 2026-09-18 checkpoint técnico Codex. Vereditos: 1 parcial, 2 parcial, 4 parcial, 6 parcial. Criado ledger AUTOMATE-REAL com AC#1..6 reconciliados.
Teste novo test_scheduler_real_execute.py nasceu verde porque real_execute já existia; 58 passed in 2.17s na suíte Automate. Mutação always-mock na cópia isolada foi detectada: 2 failed, 1 passed in 1.55s. Fonte restaurada.
AC#4 crítico: pendente até reset. Nenhuma peça pronta; não há WINNER. Auditoria não muda produto Automate nem frontend. E2E visual N/A para este checkpoint; BDD e regressão/mutação dirigidos documentados. Revisões independentes seguem pendentes.

Regressão final desta etapa: pytest -q -p no:cacheprovider → 404 passed, 3 skipped in 36.38s (3 E2E explícitos pulados no checkout vivo; executados separadamente no worktree). Ready for QA: auditoria documentada, sem aprovação independente.
