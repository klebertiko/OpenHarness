import './build-locales.mjs';
import { copyFile, mkdir, mkdtemp, readdir, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const source = fileURLToPath(new URL('../', import.meta.url));
await mkdir(resolve(source, 'artifacts'), {recursive:true});
const output = process.argv[2] ? resolve(process.argv[2]) : await mkdtemp(resolve(source, 'artifacts/pages-'));
// Never reuse a directory: old files and symlinks must not enter a publication.
if (process.argv[2]) {
  await mkdir(dirname(output), {recursive:true});
  await mkdir(output);
}
const files = [
  'index.html', 'model.html', 'manifesto.html', 'MANIFESTO.md',
  'tokens.css', 'style.css', 'motion.css', 'theme.js', 'main.js', 'nilo.js', 'motion.js', 'i18n.js',
  'examples/hello.ohm', 'examples/hello-legacy.json', 'examples/ohm.schema.json',
  'en/index.html', 'en/model.html', 'en/manifesto.html', 'en/MANIFESTO.md', 'en/examples/hello.ohm',
  'assets/mark.svg', 'assets/nilo.svg', 'assets/nilo-poses.json',
  'assets/sora-latin.woff2', 'assets/plex-mono-latin.woff2', 'assets/OFL-Sora.txt', 'assets/OFL-Plex.txt',
  ...['studio','chats','automate','pulls'].flatMap(name => ['light','dark'].map(theme => `assets/${name}-${theme}.webp`)),
];
for (const file of files) {
  const destination = resolve(output, file);
  await mkdir(dirname(destination), {recursive:true});
  await copyFile(resolve(source, file), destination);
}
await writeFile(resolve(output, '.nojekyll'), '');
await writeFile(resolve(output, 'README.md'), `# OpenHarness website

- Português brasileiro: https://klebertiko.github.io/OpenHarness/
- American English: https://klebertiko.github.io/OpenHarness/en/

This gh-pages branch contains the static product website. Application development belongs on main and feature branches.

GitHub Pages serves the root of gh-pages without a build. To update this snapshot, run npm run build:pages in the website source folder and publish the generated public files. Keep the font licenses. Internal notes, local servers, tests, and credentials do not belong in this branch.
`);
const expected = [...files, '.nojekyll', 'README.md'].sort();
const entries = await readdir(output, {recursive:true, withFileTypes:true});
const actual = entries.filter(entry => !entry.isDirectory()).map(entry =>
  resolve(entry.parentPath, entry.name).slice(output.length + 1).replaceAll('\\', '/')
).sort();
if (JSON.stringify(actual) !== JSON.stringify(expected) || entries.some(entry => entry.isSymbolicLink())) {
  throw new Error('Publication inventory does not match the public file allowlist.');
}
console.log(`Prepared ${expected.length} public files in ${output}`);
