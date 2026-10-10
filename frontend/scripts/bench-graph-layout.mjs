// Reproduces the measurements behind docs/adr/0007-graph-auto-layout.md:
// bundle size (esbuild --minify, gzip -9), layout time, and layout quality
// (overlapping plates, centre-to-centre edge crossings, backwards edges) for
// dagre (the shipped layoutGraph seam) and, optionally, elkjs.
//
//   cd frontend
//   npm i --no-save elkjs@0.12.0        # only to include the elkjs column
//   node scripts/bench-graph-layout.mjs
//
// Needs the backend venv (or PYTHON=...) to read the bundled .ohm examples
// through the real codec. Nothing here is imported by the app.
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { gzipSync } from "node:zlib";
import { build } from "esbuild";

const frontend = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const backend = join(frontend, "..", "backend");
const require = createRequire(join(frontend, "package.json"));
const W = 212, H = 120; // plate geometry used by the shipped fixtures test
const tmp = mkdtempSync(join(tmpdir(), "oh-bench-layout-"));

// 1. Real example graphs, through the OHM codec.
const venvPy = join(backend, ".venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
const python = process.env.PYTHON ?? (existsSync(venvPy) ? venvPy : "python");
const graphs = JSON.parse(execFileSync(python, ["-I", "-c", `
import sys, json
sys.path.insert(0, ${JSON.stringify(backend)})
from oharness import codec, examples
out = {}
for e in examples.list_examples():
    g = codec.load_path(e.path)["graph"]
    out[e.id] = {"nodes": [{"id": n["id"], "position": n.get("position")} for n in g["nodes"]],
                 "edges": [{"source": x["source"], "target": x["target"]} for x in g["edges"]]}
print(json.dumps(out))
`], { encoding: "utf8", cwd: tmp }));

// 2. Bundle sizes of the minimal import of each library.
async function bundleSize(label, contents) {
  const r = await build({ stdin: { contents, resolveDir: frontend }, bundle: true, minify: true, format: "esm", write: false, logLevel: "error" });
  const code = r.outputFiles[0].contents;
  const kb = (n) => (n / 1024).toFixed(1) + " KB";
  console.log(label.padEnd(8), "min", kb(code.length), " gzip", kb(gzipSync(code, { level: 9 }).length));
}
await bundleSize("dagre", `import d from "@dagrejs/dagre"; export default d;`);
let ELK = null;
try {
  require.resolve("elkjs/lib/elk.bundled.js");
  await bundleSize("elkjs", `import E from "elkjs/lib/elk.bundled.js"; export default E;`);
  ELK = require("elkjs/lib/elk.bundled.js");
} catch { console.log("elkjs   not installed (npm i --no-save elkjs@0.12.0 to include it)"); }

// 3. The shipped seam, bundled from TypeScript.
const seam = join(tmp, "graphLayout.mjs");
await build({ entryPoints: [join(frontend, "src/lib/graphLayout.ts")], bundle: true, format: "esm", platform: "node", outfile: seam, logLevel: "error" });
const { layoutGraph } = await import(pathToFileURL(seam).href);

const fallback = (ns) => Object.fromEntries(ns.map((n, i) => [n.id, { x: 80 + (i % 4) * 180, y: 80 + Math.floor(i / 4) * 100 }]));
function metrics(g, pos) {
  const ids = g.nodes.map((n) => n.id);
  let overlap = 0;
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
    const a = pos[ids[i]], b = pos[ids[j]];
    if (a.x < b.x + W && b.x < a.x + W && a.y < b.y + H && b.y < a.y + H) overlap++;
  }
  const c = (id) => ({ x: pos[id].x + W / 2, y: pos[id].y + H / 2 });
  const seg = g.edges.filter((e) => e.source !== e.target);
  const ccw = (a, b, d) => (d.y - a.y) * (b.x - a.x) > (b.y - a.y) * (d.x - a.x);
  let cross = 0;
  for (let i = 0; i < seg.length; i++) for (let j = i + 1; j < seg.length; j++) {
    const e = seg[i], f = seg[j];
    if (e.source === f.source || e.source === f.target || e.target === f.source || e.target === f.target) continue;
    const a = c(e.source), b = c(e.target), p = c(f.source), q = c(f.target);
    if (ccw(a, p, q) !== ccw(b, p, q) && ccw(a, b, p) !== ccw(a, b, q)) cross++;
  }
  const back = seg.filter((e) => pos[e.source].x > pos[e.target].x).length;
  return { overlap, cross, back };
}
async function elkLayout(g) {
  const r = await new ELK().layout({
    id: "root",
    layoutOptions: { "elk.algorithm": "layered", "elk.direction": "RIGHT", "elk.spacing.nodeNode": "48", "elk.layered.spacing.nodeNodeBetweenLayers": "96" },
    children: g.nodes.map((n) => ({ id: n.id, width: W, height: H })),
    edges: g.edges.map((e, i) => ({ id: "e" + i, sources: [e.source], targets: [e.target] })),
  });
  return Object.fromEntries(r.children.map((c) => [c.id, { x: Math.round(c.x), y: Math.round(c.y) }]));
}

// 4. Quality and time per example.
for (const [id, g] of Object.entries(graphs)) {
  console.log();
  console.log(id, g.nodes.length, "nodes /", g.edges.length, "edges");
  // "fallback" is what the Studio drew for a node without a stored position.
  console.log("fallback", JSON.stringify(metrics(g, fallback(g.nodes))));
  if (g.nodes.every((n) => n.position)) console.log("shipped ", JSON.stringify(metrics(g, Object.fromEntries(g.nodes.map((n) => [n.id, n.position])))));
  let t = performance.now();
  const d = layoutGraph(g.nodes.map((n) => ({ id: n.id })), g.edges);
  console.log("dagre   ", JSON.stringify(metrics(g, d)), (performance.now() - t).toFixed(1), "ms");
  if (ELK) {
    t = performance.now();
    const e = await elkLayout(g);
    console.log("elkjs   ", JSON.stringify(metrics(g, e)), (performance.now() - t).toFixed(1), "ms");
  }
}
