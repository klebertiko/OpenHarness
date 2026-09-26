# Segurança da publicação

Escopo: landing estática. Esta política não substitui a revisão do aplicativo desktop e do backend.

## Gate de publicação

Não publicar com vulnerabilidades conhecidas não corrigidas, testes falhando ou revisão independente de segurança pendente. Uma limitação de hospedagem deve ser descrita concretamente e aceita explicitamente pelo responsável antes da publicação; silêncio não significa aceitação. Uma revisão sem achados não garante ausência de vulnerabilidades desconhecidas.

1. Gerar um artefato novo com `npm run build:pages`. Nunca reutilizar o destino nem copiar a pasta de desenvolvimento inteira.
2. Executar `npm run test:publication`, `npm run test:security`, `npm run test:i18n` e playback nos dois idiomas. Apontar os testes de navegador para o artefato final com `WEBSITE_URL`; Playwright é ferramenta de desenvolvimento, não dependência publicada.
3. Conferir o inventário e o diff contra a publicação anterior; procurar segredos. Submeter as alterações à revisão independente de QA e segurança.
4. Registrar a decisão, os testes, o commit e eventuais limitações aceitas. Usar PR na branch protegida para atualizações seguintes. A revisão independente continua obrigatória quando o repositório tem apenas um mantenedor e não exige uma segunda aprovação formal no GitHub.
5. Verificar o site servido após o deploy. Não promover um artefato diferente do revisado.

## Proteções da landing

As seis páginas recebem CSP antes dos recursos. A política permite scripts, estilos, fontes, imagens e fetch apenas da mesma origem; bloqueia scripts/estilos inline, eval, objetos, formulários, frames filhos e workers. `base-uri 'none'` impede alteração da base das URLs. Referrer Policy é `no-referrer`.

Dados do Nilo são validados antes de substituir a imagem estática. Falhas restauram o fallback e permitem nova requisição pelo controle de tentativa.

## Limitação do GitHub Pages

**Exceção específica aceita pelo proprietário em 11/09/2026:** manter GitHub Pages e publicar as demais correções, aceitando a incorporação em iframe somente desta landing informativa, sem login ou ações sensíveis. Não constitui precedente para ignorar a orientação OWASP em outros casos. Não se estende a páginas autenticadas, formulários, ações sensíveis, desktop ou backend. Reavaliar antes de qualquer mudança desse escopo; não inferir aceitação para outros sites semelhantes. Não significa risco zero.

Meta CSP não suporta `frame-ancestors`. `frame-src 'none'` bloqueia frames filhos; não impede outro site de incorporar esta landing. `X-Frame-Options` também requer cabeçalho HTTP. Não inserir metas ineficazes nem apresentar um frame-buster JavaScript como equivalente.

Para bloquear a incorporação completamente, a hospedagem deve fornecer `Content-Security-Policy: frame-ancestors 'none'` (junto às demais diretivas da página) ou `X-Frame-Options: DENY`. Nessa hospedagem, configurar também `X-Content-Type-Options: nosniff` e `Referrer-Policy: no-referrer` como cabeçalhos. O endereço github.io atual não oferece configuração própria desses cabeçalhos. Enquanto não houver migração, a limitação deve ser aceita explicitamente antes do release.

Referências: [OWASP CSP](https://cheatsheetseries.owasp.org/cheatsheets/Content_Security_Policy_Cheat_Sheet.html), [OWASP Clickjacking](https://cheatsheetseries.owasp.org/cheatsheets/Clickjacking_Defense_Cheat_Sheet.html).
