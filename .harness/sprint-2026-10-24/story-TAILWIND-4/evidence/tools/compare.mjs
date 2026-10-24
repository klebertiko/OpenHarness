import { createRequire } from "node:module";
import { createServer } from "node:http";
import { readFileSync, existsSync, statSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve, extname, sep } from "node:path";
const require = createRequire("D:/Development/src/OpenHarness-wt/tw4/frontend/package.json");
const { chromium } = require("playwright");
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2", ".ico": "image/x-icon", ".txt": "text/plain" };
function serve(out) {
  return new Promise(ok => { const s = createServer((req, res) => {
    const p = decodeURIComponent(new URL(req.url, "http://x").pathname); const t = resolve(out, "." + p);
    for (const c of [t, t + ".html", join(t, "index.html")]) if (t.startsWith(out) && existsSync(c) && statSync(c).isFile()) { res.writeHead(200, { "content-type": types[extname(c)] ?? "application/octet-stream" }); return res.end(readFileSync(c)); }
    res.writeHead(404); res.end("nf"); }); s.listen(0, "127.0.0.1", () => ok([s, "http://127.0.0.1:" + s.address().port])); });
}
const dirs = { before: "D:/Development/src/OpenHarness-wt/base-main/frontend/out", after: "D:/Development/src/OpenHarness-wt/tw4/frontend/out" };
const outRoot = process.argv[2]; mkdirSync(outRoot, { recursive: true });
const browser = await chromium.launch({ channel: "msedge", headless: true });
const shots = {};
for (const [name, dir] of Object.entries(dirs)) {
  const [srv, base] = await serve(resolve(dir));
  for (const theme of ["dark", "light"]) for (const width of [1440, 375]) {
    const ctx = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: "reduce", deviceScaleFactor: 1 });
    await ctx.addInitScript(t => { try { localStorage.setItem("oharness-theme", t); } catch {} }, theme);
    await ctx.route("http://127.0.0.1:8000/**", r => r.fulfill({ status: 503, body: "{}" }));
    const page = await ctx.newPage();
    const steps = [["home", "/", async () => {}], ["dev-canvas", "/dev/canvas", async () => {}],
      ["chats", "/", async () => { await page.getByRole("button", { name: "Chats", exact: true }).click().catch(() => {}); }],
      ["providers", "/", async () => { await page.getByRole("button", { name: "Providers", exact: true }).click().catch(() => {}); }],
      ["palette", "/", async () => { await page.keyboard.press("Control+k"); }],
      ["studio", "/", async () => { await page.getByRole("button", { name: "Studio", exact: true }).click().catch(() => {}); }],
      ["dev-design-system", "/dev/design-system", async () => {}], ["dev-nilo", "/dev/nilo", async () => {}],
      ...[2, 4, 7, 11].map(n => ["tab" + n, "/", async () => { for (let i = 0; i < n; i++) await page.keyboard.press("Tab"); }]),
      ...[3, 6].map(n => ["studio-tab" + n, "/", async () => { await page.getByRole("button", { name: "Studio", exact: true }).click().catch(() => {}); await page.waitForTimeout(300); for (let i = 0; i < n; i++) await page.keyboard.press("Tab"); }]),
      ["hover-btn", "/", async () => { await page.getByRole("button", { name: "Studio", exact: true }).click().catch(() => {}); await page.waitForTimeout(300); await page.getByRole("button", { name: "New harness" }).first().hover().catch(() => {}); }]];
    for (const [label, path, act] of steps) {
      await page.goto(base + path, { waitUntil: "networkidle" }).catch(() => {});
      await page.addStyleTag({ content: "*,*::before,*::after{transition:none!important;animation:none!important;caret-color:transparent!important}" });
      await act(); await page.waitForTimeout(700);
      const key = [label, theme, width].join("-");
      (shots[key] ??= {})[name] = await page.screenshot({ path: join(outRoot, `${name}-${key}.png`) });
    }
    await ctx.close();
  }
  srv.close();
}
await browser.close();
let bad = 0;
for (const [key, v] of Object.entries(shots)) { const same = v.before.equals(v.after); if (!same) bad++; console.log(same ? "SAME " : "DIFF ", key); }
console.log(bad + " differing of " + Object.keys(shots).length);
