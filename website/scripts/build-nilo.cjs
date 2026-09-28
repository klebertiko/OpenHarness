// Regenerate after desktop mascot changes: node website/scripts/build-nilo.cjs
// Uses the frontend's existing TypeScript dependency only at generation time.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('../../frontend/node_modules/typescript');
const brand = path.resolve(__dirname, '../../frontend/src/components/brand');
const cache = {};
function compile(source, name) {
  const code = ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020}}).outputText;
  const exports = {};
  vm.runInNewContext(code, {exports, require: id => load(id.replace('./',''))}, {filename: name});
  return exports;
}
function load(name) {
  return cache[name] ||= compile(fs.readFileSync(path.join(brand, name + '.ts'), 'utf8'), name);
}
const {niloFrame, NILO_CANVAS} = load('niloFrames');
const source = fs.readFileSync(path.join(brand, 'NiloSprite.tsx'), 'utf8');
const ast = ts.createSourceFile('NiloSprite.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const names = new Set(['FRAME_MS', 'STILL', 'step']);
const selected = ast.statements.filter(node =>
  (ts.isFunctionDeclaration(node) && node.name?.text === 'statePose') ||
  (ts.isVariableStatement(node) && node.declarationList.declarations.some(d => names.has(d.name.getText(ast))))
).map(node => node.getText(ast)).join('\n');
const {statePose, STILL} = compile(selected + '\nexport {statePose, STILL};', 'poses');
const counts = {thinking: 18, working: 24, waiting: 8};
const frames = rows => rows.map(row => row.join(''));
const data = {source: 'frontend/src/components/brand/niloFrames.ts + NiloSprite.tsx', canvas: NILO_CANVAS, idle: frames(niloFrame()), states: {}};
for (const [state, count] of Object.entries(counts)) {
  data.states[state] = {still: frames(niloFrame(STILL[state])), frames: Array.from({length: count}, (_, i) => frames(niloFrame(statePose(state, i * 110))))};
}
fs.writeFileSync(path.join(__dirname, '../assets/nilo-poses.json'), JSON.stringify(data) + '\n');
console.log('Generated canonical Nilo frames without changing desktop sources.');
