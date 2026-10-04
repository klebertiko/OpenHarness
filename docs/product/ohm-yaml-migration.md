# Handoff para Claude — migração OHM para YAML

**Base:** [ADR 0003 aceita](../adr/0003-ohm-yaml.md). **Ordem:** P1 codec + roundtrip → P2 engine loops, entrega separada. Este handoff só cria documentação; os arquivos de implementação abaixo são trabalho futuro. Preservar as alterações já existentes na árvore.

## Pontos confirmados no código

| Área | Estado que orienta a migração |
| --- | --- |
| Modelo | `backend/oharness/models.py` e `schema/oharness.schema.json` exigem o envelope OHM; nodes/edges são pouco tipados. `schemaVersion` é string obrigatória, sem default ou enum no contrato. |
| Versões | Constante/compiler/default usam `1.0.0`; `composeBundleFromCanvas` cria fallback `1.1.0` e usa `1.0.0` se a versão da base for vazia. Não há versão unificada implementada. |
| Arquivos/API | `validate_path`, `GET /bundles/default`, Studio e biblioteca fazem parse JSON; `downloadOHarness` gera JSON. O default `.ohm` contém JSON. `validate_dict` valida estrutura e referências, não aciclicidade. |
| Canvas | `bundlesApi.ts` reduz nós a id/role/label e arestas a id/source/target. `bundleGraph.ts` preserva parte de data/posição/handles, converte tipos legados e pode sobrepor prompt para execução; não é codec reversível. Studio só carrega grafo com type/posição. Não há viewport persistido nos contratos Graph/HarnessGraph/CanvasState lidos. |
| Execução | `mock_run.py` usa Kahn e retorna `ok=false` para nós não ordenados. `engine.py` também usa topo-sort, informa `unreachable` e pode terminar `complete` sem executar esses nós. YAML não corrige isso. |

## P1 — sequência e dependências

1. **Fixar o contrato normalizado antes do codec.** Usar o JSON Schema existente como referência compartilhada entre Pydantic e TypeScript, com fixtures de conformidade. Definir `decode → normalize → validate` e `encode(normalized)`; API e engine recebem objetos JSON. Normalização deve ser idempotente, preservar campos de autoria aceitos e recusar campos incompatíveis com diagnóstico, nunca descartá-los. Separar adaptação para execução/overrides de prompt da representação salva. Documentar a matriz real de versões e alinhar os fallbacks; trocar JSON por YAML não incrementa `schemaVersion`. Qualquer mudança estrutural exige decisão de compatibilidade explícita.

2. **Implementar perfil restrito nos dois runtimes.** Dependências candidatas: [ruamel.yaml](https://yaml.dev/doc/ruamel.yaml/) no Python e [yaml](https://eemeli.org/yaml/) no TypeScript. Fixar versões após provar compatibilidade; não presumir que “safe loader” imponha todo o perfil. Instalar com requirements/npm, atualizar lock e verificar empacotamento do sidecar. Validar eventos/AST antes de construir objetos: exatamente um documento não vazio, raiz mapping, chaves resolvidas como strings, sem coerção de chaves numéricas/booleanas; duplicatas também com escapes equivalentes devem falhar. Recusar tags explícitas inclusive padrão, âncoras, aliases, merge keys e diretivas que troquem para YAML 1.1. Usar resolução Core 1.2 filtrada para valores JSON: sem datas/objetos especiais, NaN/Infinity ou arredondamento silencioso de inteiros fora da faixa interoperável. Cobrir `on/off/yes/no`, datas e strings numéricas com aspas nas fixtures.

3. **Limitar custo antes da materialização.** Proposta inicial, ainda não implementada: entrada UTF-8 até 8 MiB, profundidade 64, 100 mil nós sintáticos, scalar até 1 MiB e 2 s por parse. Medir contra o default e registrar ajustes com testes de fronteira. Checar bytes antes de leitura completa, contar profundidade/nós durante parsing e interromper por limite; usar worker/processo encerrável para timeout real, sem bloquear UI/event loop. Aplicar o mesmo perfil à entrada JSON legada, inclusive duplicatas, sem depender de `JSON.parse`/dict após perder informação. JSON válido é entrada compatível; extensão não determina o parser nem autoriza fallback permissivo após erro.

4. **Garantir roundtrip antes de trocar os fluxos.** Preservar IDs, type/role/label, node `data` completo, Provider primário/fallback/roteamento e referências, config, posição, edge data/Signals/kind/label, source/target handles, conteúdo, manifest/runtime/validation e extensões aceitas. Não preencher defaults sobre valores existentes nem reordenar arrays: ordem de Providers e predecessores pode afetar execução. Se houver viewport persistido na branch recebida, preservá-lo; caso contrário, não alegar suporte nem adicioná-lo fora de uma mudança coordenada de schema/modelos.

   Strings de prompts, agents, skills, hooks, commands e scripts mantêm bytes UTF-8 do valor decodificado: Unicode, CRLF/LF, tabs, espaços e zero/uma/várias quebras finais. Sem trim, dedent ou normalização Unicode. Emissão literal `|` com chomping adequado quando fiel; usar aspas/escapes para CRLF e casos não representáveis fielmente em bloco. O compiler hoje usa `Path.read_text`, que pode normalizar quebras: ler bytes e decodificar UTF-8 para preservar o conteúdo-fonte.

   Fixar um perfil de emissão comum: UTF-8, LF estrutural, indentação de dois espaços, ordem do envelope declarada no schema, demais mappings ordenados com comparador definido, arrays na ordem original, regras estáveis de escalares/aspas e uma quebra final. Ambos os emissores devem produzir os mesmos bytes para o mesmo modelo normalizado; incluir números/escapes/Unicode nas fixtures douradas. Nenhum alias emitido.

5. **Integrar todas as entradas/saídas.** Compiler continua produzindo modelo; a gravação usa o codec. Converter exemplos e default para YAML, mantendo fixtures JSON legadas nas duas extensões. CLI `python -m oharness validate <arquivo>` aceita ambos e mantém relatório JSON. Rotas `/bundles/default`, `/validate` e `/mock` continuam JSON; a primeira decodifica o default via codec. Studio, biblioteca e ações avançadas convergem para importar/exportar OHM; o grafo legado `.harness.json` continua reconhecido como entrada distinta, sem confundi-lo com envelope OHM. Carregar nós antigos via normalização mesmo sem posição/type e reexportar o documento completo após edição.

   Guardar bytes originais + nome/formato em metadados locais separados do modelo, preservados ao reabrir a biblioteca; exportação canônica cria outro arquivo, e a pessoa pode recuperar o original. Documentar ausência de roundtrip de comentários/estilo. Persistência/API JSON não vira YAML por consequência. Não publicar suporte desktop como concluído antes dos critérios abaixo. Website do usuário fica fora do escopo.

## Arquivos previstos para implementação

Caminhos relativos à raiz; novos arquivos estão marcados. Não modificar estes arquivos nesta entrega documental.

| Etapa | Arquivos |
| --- | --- |
| Codec/contratos | **Novos:** `backend/oharness/codec.py`, `frontend/src/lib/ohmCodec.ts`, `tests/fixtures/ohm/` compartilhado. Alinhar `backend/oharness/{models,validate}.py`, `backend/oharness/schema/oharness.schema.json`, `frontend/src/lib/{types,bundlesApi,bundleGraph}.ts`. |
| Default/CLI/API | `backend/oharness/{compile_skills_harness,cli}.py`, `backend/oharness/fixtures/default-agile.ohm`, `backend/routers/bundles.py`, fixtures em `backend/tests/oharness/fixtures/`. Conferir referências de recursos em `src-tauri/tauri.conf.json` e o processo de empacotamento. |
| Canvas/import/export | `frontend/src/components/studio/ValidateDock.tsx`, `components/harnesses/HarnessLibrary.tsx`, `components/toolbar/Toolbar.tsx`, `lib/actions.ts`, `store/{canvasStore,harnessSessionStore,harnessLibraryStore}.ts` (todos sob `frontend/src/`). `components/canvas/HarnessCanvas.tsx` somente se a integração exigir. |
| Dependências/docs | `backend/requirements.txt`, `frontend/package.json`, `frontend/package-lock.json`; `CONTEXT.md`, `README.md`, `docs/harness-spec/{README,HELLO}.md` e exemplos. Atualizar este checklist com evidências; preservar ADRs anteriores. |
| Verificação P1 | `backend/tests/conftest.py`, `backend/tests/oharness/test_{validate,schema_models,compile_default,cli,api_bundles,mock_run}.py`; **novo** `test_codec.py` nessa pasta. `frontend/src/lib/{bundlesApi,bundleGraph}.test.ts`, **novo** `ohmCodec.test.ts`; testes de importação/exportação e stores junto aos consumidores. |
| P2 separado | `backend/engine.py`, `backend/oharness/mock_run.py`, `backend/routers/execution.py`, contratos/schema e consumidores SSE/HITL do frontend conforme o contrato de loops a definir. Não alterar o engine em P1 para “aceitar ciclos”. |

## Aceitação e testes isolados

Executar testes com parsers/emissores reais, fixtures locais versionadas e endpoints reais via TestClient; não substituir o codec por mocks. Antes de importar `main/database`, configurar `DATABASE_URL` para SQLite temporário absoluto, storage/secrets temporários e token de teste; falhar se qualquer caminho resolver para dados do usuário. O `backend/tests/conftest.py` atual configura autenticação, **não isolamento do banco**. Não iniciar o desktop nem usar `backend/data/harness.db`. Subprocessos CLI recebem o mesmo ambiente isolado. Substituir a dependência do teste do compiler em `D:\Development\src\skills-framework` por uma árvore-fonte mínima em `tmp_path`; sem Provider real ou rede.

- [ ] JSON legado `.ohm/.oharness` e YAML equivalente produzem o mesmo modelo normalizado. `decode(encode(N)) == N`, `normalize(N) == N`; segunda exportação idêntica byte a byte, inclusive Python ↔ TypeScript.
- [ ] Arquivo → biblioteca/Studio → editar um campo → exportar → reimportar mantém todos os demais campos de autoria, bindings, Signals, handles, posições e conteúdo multiline; não basta testar helpers isolados. Original recuperável após recarga, sem promessa de comentários no canônico.
- [ ] Fixtures negativas verificam multidocumento, vazio, raiz inválida, chaves não string/duplicadas, tags, aliases/âncoras/merge, YAML 1.1, números não interoperáveis e cada limite. Erros com caminho e linha/coluna quando disponíveis; nenhuma importação parcial nem destruição do estado anterior.
- [ ] Default YAML carregado pela rota, compiler preservando conteúdo e CLI YAML/JSON passam; endpoints mantêm contratos JSON. Grafo cíclico pode ser importado/serializado como dados, mas não é anunciado como executável; mock comunica a limitação, sem habilitar loops em P1.
- [ ] Rodar suíte OHM no backend com isolamento previamente comprovado; no `frontend/`, testes Vitest pertinentes, `npm run typecheck` e `npm run build`. Registrar comandos/resultados reais e distinguir falhas preexistentes. Empacotamento inclui parser/default atualizados.

## P2 — loops como capacidade de execução

Antes de implementar, definir contrato próprio e obter decisão sobre pontos abertos: condição de entrada/continuação/saída e Signals, estado por iteração, máximo obrigatório de iterações, orçamento de tokens/custo, timeout por operação e total, cancelamento durante stream/espera, HITL em cada passagem e aprovação/rejeição/retomada. Sintaxe, valores padrão, escopo de contadores e política de retomada ainda não estão aprovados.

Projetar transições explícitas e identificação de iterações nos eventos/resultados; separar validação estrutural de elegibilidade de execução. Não remover simplesmente topo-sort nem reutilizar um único output por nó para todas as passagens. Grafos sem contrato de ciclo devem receber diagnóstico explícito, nunca sucesso parcial. Aceitar P2 somente com testes de loop finito por condição, cada limite, timeout, cancelamento e HITL repetido, além de regressão DAG e paridade do planejador mock com o engine; usar adapters controlados e dados temporários.
