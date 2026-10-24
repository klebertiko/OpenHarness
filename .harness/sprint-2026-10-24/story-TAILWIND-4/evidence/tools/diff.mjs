import { PNG } from "pngjs"; import { readFileSync, readdirSync } from "node:fs";
const dir = process.argv[2];
for (const f of readdirSync(dir).filter(f => f.startsWith("before-"))) {
  const a = PNG.sync.read(readFileSync(dir + "/" + f)), b = PNG.sync.read(readFileSync(dir + "/" + f.replace("before-", "after-")));
  let n = 0, x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
  for (let y = 0; y < a.height; y++) for (let x = 0; x < a.width; x++) { const i = (y * a.width + x) * 4; if (a.data[i] !== b.data[i] || a.data[i+1] !== b.data[i+1] || a.data[i+2] !== b.data[i+2]) { n++; x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); } }
  console.log(n === 0 ? "0px  " : n + "px", f.slice(7, -4), n ? `bbox ${x0},${y0}-${x1},${y1}` : "");
}
