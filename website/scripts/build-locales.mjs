import { readFile, writeFile, mkdir } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const publicUrl = 'https://klebertiko.github.io/OpenHarness/';
const catalog = JSON.parse(await readFile(new URL('locales/en-US.json', root), 'utf8'));
const neutral = new Set(['OpenHarness', 'Manifesto', 'manifesto', 'Menu', 'Skill', 'Gate', 'Harness Studio', 'Chats', 'Automate', 'Pull requests', 'Open Harness Model', 'OPEN HARNESS MODEL', 'YAML', 'manifest + graph', 'content', 'runtime + validation', 'AGENTS.md', 'Agent Skills', 'MCP', 'A2A', 'OpenHarness desktop', 'schemaVersion', 'manifest', 'graph', 'nodes', 'edges', 'runtime', 'validation', 'license', 'hello.ohm', '.ohm', '.oharness', 'Manifesto ↗', 'Manifesto — OpenHarness', 'Harness Model.']);
const missing = new Set();
const escape = text => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

function translate(text) {
  const key = text.trim();
  if (!key || !/\p{L}/u.test(key) || neutral.has(key)) return text;
  if (!Object.hasOwn(catalog, key)) { missing.add(key); return text; }
  return text.replace(key, escape(catalog[key]));
}

function stripLocaleMarkup(html) {
  return html.replace(/<!-- security-meta:start -->[\s\S]*?<!-- security-meta:end -->\s*/g, '')
    .replace(/<!-- locale-meta:start -->[\s\S]*?<!-- locale-meta:end -->\s*/g, '')
    .replace(/<a class="language-switch"[^>]*>[\s\S]*?<\/a>\s*/g, '');
}

function decorate(html, file, english) {
  const policy = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'; connect-src 'self'; base-uri 'none'; object-src 'none'; form-action 'none'; frame-src 'none'; worker-src 'none'";
  const security = `<!-- security-meta:start -->\n<meta http-equiv="Content-Security-Policy" content="${policy}">\n<meta name="referrer" content="no-referrer">\n<!-- security-meta:end -->\n`;
  const pt = file === 'index.html' ? publicUrl : publicUrl + file;
  const en = file === 'index.html' ? publicUrl + 'en/' : publicUrl + 'en/' + file;
  const metadata = `<!-- locale-meta:start -->\n<link rel="canonical" href="${english ? en : pt}">\n<link rel="alternate" hreflang="pt-BR" href="${pt}">\n<link rel="alternate" hreflang="en-US" href="${en}">\n<link rel="alternate" hreflang="x-default" href="${pt}">\n<meta property="og:url" content="${english ? en : pt}">\n<meta property="og:locale:alternate" content="${english ? 'pt_BR' : 'en_US'}">\n<!-- locale-meta:end -->\n`;
  const switcher = english
    ? `<a class="language-switch" href="../${file}" lang="pt-BR" hreflang="pt-BR" aria-label="Ler em português brasileiro" title="Português brasileiro">PT</a>`
    : `<a class="language-switch" href="./en/${file}" lang="en-US" hreflang="en-US" aria-label="Read in American English" title="English (US)">EN</a>`;
  // Meta CSP must precede every resource. frame-ancestors requires an HTTP header.
  return html.replace('<meta charset="utf-8">', '<meta charset="utf-8">\n' + security)
    .replace('</head>', metadata + '</head>')
    .replace('<button class="theme-toggle"', switcher + '<button class="theme-toggle"');
}

const yaml = (await readFile(new URL('examples/hello.ohm', root), 'utf8'))
  .replace('OHM em YAML 1.2 — suporte no desktop em migração.', 'OHM in YAML 1.2 — desktop support is being migrated.')
  .replace('Exemplo mínimo do Open Harness Model.', 'Minimal Open Harness Model example.')
  .replace('objetivo:', 'objective:')
  .replace('Descreva o objetivo do trabalho.', 'Describe the objective of the work.')
  .replace('Defina as evidências para aceitar o resultado.', 'Define the evidence required to accept the result.');

const outputs = [];
for (const file of ['index.html', 'model.html', 'manifesto.html']) {
  const source = stripLocaleMarkup(await readFile(new URL(file, root), 'utf8'));
  // These controlled static templates contain no inline scripts or angle brackets in attributes.
  let english = source.split(/(<[^>]*>)/g).map(part => {
    if (part.startsWith('<')) {
      return part.replace(/\b(alt|aria-label|title)="([^"]*)"/g, (_, attr, value) => `${attr}="${translate(value)}"`)
        .replace(/(<meta\b[^>]*(?:name="description"|property="og:(?:title|description)")[^>]*content=")([^"]*)"/g, (_, before, value) => `${before}${translate(value)}"`);
    }
    if (part.includes('schemaVersion:')) return escape(yaml);
    return translate(part);
  }).join('');
  english = english.replace('lang="pt-BR"', 'lang="en-US"').replace('content="pt_BR"', 'content="en_US"')
    .replace(/(src|href)="\.\/(assets\/[^\"]+|[\w.-]+\.(?:js|css)|examples\/(?:ohm.schema.json|hello-legacy.json))"/g, '$1="../$2"')
    .replace('https://agilemanifesto.org/iso/ptbr/manifesto.html', 'https://agilemanifesto.org/');
  outputs.push([file, decorate(source, file, false)], ['en/' + file, decorate(english, file, true)]);
  if (file === 'manifesto.html') {
    const article = english.match(/<article>([\s\S]*?)<\/article>/)[1];
    const paragraphs = [...article.matchAll(/<p>([\s\S]*?)<\/p>/g)].map(match => match[1]
      .replace(/<\/?strong>/g, '**').replace(/<\/?code>/g, '`').replace(/<[^>]+>/g, '')
      .replaceAll('&quot;', '"').replaceAll('&amp;', '&').trim());
    outputs.push(['en/MANIFESTO.md', '# Toward an Open Harness Model\n\n' + paragraphs.join('\n\n') + '\n']);
  }
}
if (missing.size) throw new Error('Missing en-US translations:\n' + [...missing].join('\n'));
outputs.push(['en/examples/hello.ohm', yaml]);
for (const [file, content] of outputs) {
  const destination = new URL(file, root);
  await mkdir(new URL('.', destination), { recursive: true });
  await writeFile(destination, content);
}
console.log('Generated three en-US pages, localized downloads, language links, and metadata.');
