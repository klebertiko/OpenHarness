# ADR 0006 — Cascata Laya na porta de entrada com fallback explícito

Status: Aceito (2026-10-05)

## Contexto

O chat já possui uma triagem de uma chamada em `backend/triage.py`: o mesmo
turno do provider responde diretamente como Nilo ou devolve o sentinel que
engaja o grafo completo. Isso evita uma segunda chamada no caminho direto,
mas toda mensagem ainda paga a inferência do provider para decidir.

A ADR-0005 introduziu Laya como nó consultivo de grafo, sem autoridade sobre
gates ou merge. A decisão de produto posterior é também experimentar Laya
antes da triagem do provider na porta de entrada, preservando a triagem atual
como fallback quando a classificação local não é confiável ou não está
disponível.

## Decisão

1. A ordem é **Laya → triagem atual pelo modelo**. Laya é consultada primeiro
   por loopback em `127.0.0.1`; indisponibilidade, timeout, payload inválido ou
   confiança abaixo do limiar acionam a triagem anterior sem bloquear o chat.
2. O contrato usa a pergunta estável `engage_harness` do tipo `noul`. O valor
   deve estar entre 0 e 1. Valores a partir de 0,5 indicam Harness; abaixo de
   0,5 indicam resposta direta. A confiança é `max(p, 1-p)`.
3. O limiar inicial é 0,80. Somente resultados iguais ou superiores ao limiar
   têm autoridade para escolher o caminho de execução.
4. Quando Laya escolhe Harness com confiança suficiente, não há chamada de
   triagem ao provider. Quando escolhe resposta direta, o provider produz
   apenas a resposta do Nilo, sem reclassificar. No fallback, o prompt e a
   semântica da triagem anterior permanecem inalterados.
5. A decisão gera um evento persistido `route_decision` com `source`, `reason`,
   `engage_harness`, `confidence` e `latency_ms`. O detalhe ao vivo e o replay
   histórico mostram quem decidiu.
6. Laya continua sem autoridade sobre gates, HITL, labels, CI, release ou
   merge. Ela escolhe apenas entre a resposta de porta de entrada e iniciar o
   grafo que já foi selecionado; não altera edges nem resultados internos.
7. Pesos/cache da Laya continuam fora de `OH_SECRETS`. A comunicação permanece
   restrita ao loopback local e não recebe credenciais de provider.

## Falhas e segurança

- O cliente valida estrutura, tipo e intervalo do resultado antes de usá-lo.
- Qualquer exceção do loopback degrada para `model_fallback`; não fabrica uma
  decisão e não suprime trabalho que poderia exigir o Harness.
- O timeout da consulta local é curto e separado dos timeouts de provider.
- `route_decision` registra proveniência, não conteúdo secreto nem prompt.
- Budget de provider só é consumido quando há chamada real ao provider; uma
  decisão Laya de engajar o Harness não cria gasto fictício de triagem.

## Consequências

- Perguntas simples continuam tendo uma resposta do Nilo, mas a escolha pode
  ser atribuída à Laya no detalhe da execução.
- Pedidos de trabalho classificados com alta confiança pulam o custo da
  triagem do provider e iniciam diretamente o grafo.
- Uma Laya ausente não derruba o desktop; o comportamento anterior permanece
  como fallback observável.
- Calibração do limiar deve usar telemetria agregada e revisão humana. Ela não
  pode ser promovida a gate determinístico sem nova ADR.

## Alternativas rejeitadas

- **Laya sem fallback:** rejeitada porque tornaria um componente local opcional
  um ponto único de falha do chat.
- **Duas chamadas do provider no caminho direto:** rejeitada por custo e
  latência; a decisão Laya confiante transforma a chamada restante somente em
  geração da resposta.
- **Fallback silencioso:** rejeitado; a autoria precisa aparecer no stream e no
  histórico para operação, QA e calibração.
- **Laya alterando gates ou merge:** rejeitada pelos limites de autoridade já
  estabelecidos na ADR-0005 e reiterados nesta decisão.
