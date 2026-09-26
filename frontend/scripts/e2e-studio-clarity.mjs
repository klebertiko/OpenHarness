import assert from "node:assert/strict";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const require = createRequire(import.meta.url);
const frontend = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = resolve(frontend, "../.harness/sprint-2026-09-13/story-STUDIO-CLARITY/evidence/e2e");
mkdirSync(output, { recursive: true });
const resultPath = resolve(output, "result.json");
const startedAt = new Date().toISOString();
const fixture = JSON.parse(readFileSync(resolve(frontend, "src/lib/fixtures/ohm-roundtrip.json"), "utf8"));
const bundled = {
  ...fixture,
  manifest: { ...fixture.manifest, id: "openharness.default.agile", name: "OpenHarness Agile (skills-framework)" },
  graph: {
    nodes: [
      { id: "writer", type: "agent", position: { x: 120, y: 90 }, data: { label: "Writer", providerIds: [] } },
      { id: "reviewer", type: "agent", position: { x: 520, y: 90 }, data: { label: "Reviewer", providerIds: [] } },
    ],
    edges: [{ id: "review", source: "writer", target: "reviewer" }],
  },
};
const connections = [
  { id: "anthropic", provider: "anthropic", label: "Anthropic", residence: "cloud", endpoint: "", enabled: true, secretRef: null },
  { id: "openai", provider: "openai", label: "OpenAI", residence: "cloud", endpoint: "", enabled: true, secretRef: null },
  { id: "ollama-local", provider: "ollama", label: "Ollama local", residence: "local", endpoint: "http://127.0.0.1:11434", enabled: false, secretRef: null },
];
const errors = [], unexpectedRequests = [], executions = [], responsive = [], validations = [], browserLog = [];
let browser, context, page, failDefault = false, step = "startup";
writeFileSync(resultPath, JSON.stringify({ result: "running", startedAt }, null, 2));
const REACTFLOW_RUNTIME_KEYS = ["measured", "selected", "dragging"];
function authoring(bundle) {
  const copy = structuredClone(bundle);
  copy.graph.nodes = copy.graph.nodes.map((node) => {
    const rest = { ...node };
    for (const key of REACTFLOW_RUNTIME_KEYS) delete rest[key];
    return rest;
  });
  return copy;
}
async function download(name) {
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export .ohm", exact: true }).click();
  const file = await pending;
  await file.saveAs(resolve(output, name));
  return JSON.parse(readFileSync(resolve(output, name), "utf8"));
}
async function pin(id, provider) {
  await page.locator('.react-flow__node[data-id="' + id + '"]').click();
  await page.getByLabel("Connection pin", { exact: true }).selectOption(provider);
}
try {
  const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
  browser = await chromium.launch({ channel: "msedge", headless: true });
  context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1440, height: 1000 } });
  page = await context.newPage();
  page.setDefaultTimeout(12000);
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") browserLog.push(message.text()); });
  await context.addInitScript(() => { window.__OH_API__ = "http://127.0.0.1:8000"; });
  // All sidecar traffic is intercepted. No real database writes or provider calls.
  await context.route("http://127.0.0.1:8000/**", async route => {
    const request = route.request();
    const key = request.method() + " " + new URL(request.url()).pathname;
    const responses = {
      "GET /bundles/default": bundled,
      "GET /health": { status: "ok" },
      "GET /cowork/projects": { projects: [] },
      "GET /providers/connections": { connections },
    };
    if (key === "GET /bundles/default" && failDefault) {
      await route.fulfill({ status: 503, contentType: "application/json", body: '{"detail":"E2E offline fixture"}' }); return;
    }
    if (key === "POST /execute/") {
      executions.push(request.postDataJSON());
      await route.fulfill({ status: 200, contentType: "text/event-stream", body: 'event: run_start\ndata: {"run_id":"studio-e2e"}\n\nevent: harness_done\ndata: {"status":"completed"}\n\n' }); return;
    }
    let body = responses[key];
    if (key === "POST /bundles/validate") { validations.push(request.postDataJSON()); body = { ok: true, errors: [] }; }
    else if (!Object.hasOwn(responses, key)) {
      unexpectedRequests.push(key);
      await route.fulfill({ status: 501, contentType: "application/json", body: JSON.stringify({ detail: "Unstubbed E2E request: " + key }) }); return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });
  await page.goto("http://127.0.0.1:3000", { waitUntil: "networkidle" });
  step = "slash command menu";
  const composer = page.getByRole("textbox", { name: "Message OpenHarness" });
  await composer.fill("/");
  await page.getByRole("listbox", { name: "Commands and skills" }).waitFor();
  await composer.press("ArrowDown");
  assert.ok(await composer.getAttribute("aria-activedescendant"));
  await page.screenshot({ path: resolve(output, "slash-menu.png") });
  await composer.press("Escape");
  assert.equal(await composer.inputValue(), "/");
  await composer.fill("/pro");
  assert.equal(await page.getByRole("option").count(), 1);
  await composer.press("Enter");
  await page.getByRole("button", { name: "Chat provider: Auto", exact: true }).waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "Chats", exact: true }).click();
  step = "truthful provider selection";
  const auto = page.getByRole("button", { name: /Chat provider: Auto.*Not verified/ });
  await auto.waitFor();
  assert.equal(await auto.locator(".bg-signal").count(), 0, "Unverified must not display the live color");
  await auto.click();
  await page.getByRole("option", { name: /^OpenAI Not verified/ }).click();
  const chosen = page.getByRole("button", { name: /Chat provider: OpenAI.*Not verified/ });
  await chosen.waitFor();
  assert.equal(await chosen.locator(".bg-signal").count(), 0);
  await chosen.click();
  await page.screenshot({ path: resolve(output, "provider-picker.png") });
  await page.getByRole("button", { name: "Configure OpenAI", exact: true }).click();
  await page.locator("main").getByText("OpenAI", { exact: true }).first().waitFor();

  step = "Studio sample and draft preservation";
  await page.getByRole("button", { name: "Studio", exact: true }).click();
  await page.getByRole("heading", { name: "Harness Studio", exact: true }).waitFor();
  await page.screenshot({ path: resolve(output, "overview.png") });
  await page.getByRole("button", { name: "Open sample", exact: true }).click();
  await page.locator('.react-flow__node[data-id="impl"]').waitFor();
  assert.equal(await page.locator(".react-flow__node").count(), 3);
  await pin("impl", "anthropic");
  const before = await download("draft-before.ohm");
  await page.getByRole("button", { name: "Back to Studio", exact: true }).click();
  await page.getByRole("button", { name: "Continue editing", exact: true }).click();
  const resumed = await download("draft-resumed.ohm");
  assert.deepEqual(authoring(resumed), authoring(before), "Back/resume must retain edits, metadata and content");

  step = "bundled load failure and retry";
  await page.getByRole("button", { name: "Back to Studio", exact: true }).click();
  failDefault = true;
  await page.getByRole("button", { name: "Open framework", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "Could not load" }).waitFor();
  await page.getByRole("button", { name: "Continue editing", exact: true }).click();
  assert.deepEqual(authoring(await download("draft-after-error.ohm")), authoring(before));
  await page.getByRole("button", { name: "Back to Studio", exact: true }).click();
  failDefault = false;
  await page.getByRole("button", { name: "Open framework", exact: true }).click();
  await page.locator('.react-flow__node[data-id="writer"]').waitFor();
  assert.equal(await page.locator(".react-flow__node").count(), 2, "Framework must come from HTTP fixture, not frontend sketch");

  step = "independent provider pins and explicit Use in chat";
  await pin("writer", "anthropic");
  await pin("reviewer", "openai");
  await page.locator('.react-flow__node[data-id="writer"]').click();
  assert.equal(await page.getByLabel("Connection pin", { exact: true }).inputValue(), "anthropic");
  const pinned = await download("pinned.ohm");
  assert.deepEqual(pinned.graph.nodes.map(n => n.data.providerIds), [["anthropic"], ["openai"]]);
  assert.deepEqual(pinned.content, bundled.content);
  await page.screenshot({ path: resolve(output, "editor-pins.png") });
  await page.getByRole("button", { name: "Use in chat", exact: true }).click();
  await page.locator("main textarea").last().fill("Check the routing of these two agents.");
  const executionResponse = page.waitForResponse(response => response.request().method() === "POST" && new URL(response.url()).pathname === "/execute/");
  await page.locator("main textarea").last().press("Control+Enter");
  await executionResponse;
  await page.waitForFunction(() => !document.querySelector("main textarea")?.disabled);
  assert.equal(executions.length, 1, "One execution request must reach the intercepted HTTP boundary");
  assert.deepEqual(executions[0].graph_json.nodes.map(n => n.data.providerIds), [["anthropic"], ["openai"]]);

  step = "importing an edited default-ID bundle";
  await page.getByRole("button", { name: "Studio", exact: true }).click();
  await page.getByRole("button", { name: "Back to Studio", exact: true }).click();
  await page.getByRole("button", { name: "Open .ohm", exact: true }).click();
  const imported = { ...bundled, manifest: { ...bundled.manifest, name: "Edited framework copy" }, graph: { nodes: [{ id: "edited-copy", type: "agent", role: "agent", label: "Edited copy", position: { x: 120, y: 100 }, data: { label: "Edited copy", providerIds: ["openai"] } }], edges: [] } };
  await page.getByRole("dialog", { name: "Harness library" }).locator('input[type="file"]').setInputFiles({ name: "edited.ohm", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(imported)) });
  await page.locator('.react-flow__node[data-id="edited-copy"]').waitFor();
  const importedExport = await download("edited-copy.ohm");
  assert.equal(importedExport.manifest.name, imported.manifest.name);
  assert.deepEqual(authoring(importedExport).graph, imported.graph);
  assert.deepEqual(importedExport.content, imported.content);
  assert.deepEqual(validations, [imported]);

  step = "overview responsive bounds";
  await page.getByRole("button", { name: "Back to Studio", exact: true }).click();
  for (const width of [320, 375, 414, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    const bounds = await page.locator('section[aria-labelledby="studio-heading"]').evaluate(section => {
      const overflow = [...section.querySelectorAll("button")].filter(button => {
        const r = button.getBoundingClientRect(); return r.left < 0 || r.right > innerWidth + 1;
      }).map(button => button.textContent);
      return { overflow, documentOverflow: document.documentElement.scrollWidth > innerWidth };
    });
    responsive.push({ width, ...bounds });
    assert.deepEqual(bounds.overflow, [], "Overview controls must fit at " + width);
    await page.screenshot({ path: resolve(output, "overview-" + width + ".png") });
  }
  step = "provider and slash menu responsive keyboard";
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("button", { name: "Chats", exact: true }).click();
  for (const width of [320, 375, 414, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    const chip = page.getByRole("button", { name: /Chat provider: OpenAI/ });
    await chip.click();
    const menu = page.getByRole("listbox", { name: "Chat provider" });
    await menu.waitFor();
    const bounds = await menu.boundingBox();
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width + 1, "Provider menu bounds " + width);
    await menu.press("ArrowUp");
    await page.screenshot({ path: resolve(output, "provider-" + width + ".png") });
    await menu.press("Escape");
    const draft = page.getByRole("textbox", { name: "Message OpenHarness" });
    await draft.fill("/");
    const commands = page.getByRole("listbox", { name: "Commands and skills" });
    const cb = await commands.boundingBox();
    assert.ok(cb.x >= 0 && cb.x + cb.width <= width + 1, "Slash menu bounds " + width);
    await page.screenshot({ path: resolve(output, "slash-" + width + ".png") });
    await draft.press("Escape"); await draft.fill("");
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(unexpectedRequests, []);
  assert.equal(await page.getByText("Unhandled Runtime Error", { exact: true }).count(), 0);
  writeFileSync(resultPath, JSON.stringify({ result: "passed", startedAt, finishedAt: new Date().toISOString(), scope: "Browser UI and serialized execution request; sidecar HTTP and execution responses stubbed. No live provider calls.", executions: executions.length, validations: validations.length, responsive, pageErrors: errors, unexpectedRequests }, null, 2));
  console.log("PASS: provider clarity, Studio open/back/resume, source loading/error recovery, per-agent pins, explicit chat handoff, same-ID import, responsive overview.");
} catch (error) {
  writeFileSync(resultPath, JSON.stringify({ result: "failed", step, startedAt, finishedAt: new Date().toISOString(), error: error.message, pageErrors: errors, unexpectedRequests, browserLog, responsive }, null, 2));
  if (page) {
    writeFileSync(resolve(output, "failure.txt"), String(error.stack) + "\n" + await page.locator("body").innerText());
    await page.screenshot({ path: resolve(output, "failure.png") }).catch(() => {});
  }
  throw error;
} finally {
  await context?.close();
  await browser?.close();
}
