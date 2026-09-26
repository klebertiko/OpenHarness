# Story DIRECT-HISTORY — Histórico persistido da execução direta

Dono: **Codex** (BE). Fecha o RED que o próprio Codex escreveu:
`backend/tests/test_execution_provider_resolution.py::test_direct_history_survives_a_fresh_detail_request`.

As a usuário que rodou uma instrução em modo direto,
I want abrir o log dessa execução depois, pelo `run_id`,
So that a execução direta tenha o mesmo histórico da execução por harness.

## Acceptance Criteria
1. `POST /execute/direct` persiste um `ExecutionLog` com o mesmo `run_id` do header `X-Execution-Id`.
2. `GET /execute/logs/{run_id}` devolve 200 com `status`, `result.events` incluindo `node_done`
   com `output`, `connection_id` e `provider_verified` reais.
3. `GET /execute/logs` lista execuções diretas ao lado das de harness, com campo que distingue o modo.
4. Falha do provider persiste `status: "failed"` com a classificação estruturada já existente em
   `providers/outcomes.py`.

## Testing seams
- AC#1/2 → o teste RED existente passa sem ser editado
- AC#3 → `routers/execution.py::list_logs` → integração
- AC#4 → `routers/execution.py::direct` com provider fake que falha → integração

## Definition of Done
- [ ] RED existente vira GREEN; ledger registra a passagem
- [ ] Suíte backend verde, contagem real
- [ ] QA fresh-context (depois do reset); ARCH
- [ ] PO accepted in Sprint Review

## Story Points
3

## Priority
P1
