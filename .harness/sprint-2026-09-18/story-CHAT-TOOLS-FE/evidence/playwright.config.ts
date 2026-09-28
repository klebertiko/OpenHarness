import { defineConfig } from "@playwright/test";

/**
 * Real E2E against the isolated worktree's own frontend (:1420) and backend
 * (:8002) — never the live checkout's dev servers (:3000/:8000). Port 1420
 * (not 3002/3001) because the backend's CORS allowlist (main.py, SEC-3) only
 * grants localhost:3000 and the Tauri dev origins (1420) — any other port
 * gets a 400 on preflight. Servers are started manually before this runs
 * (see ledger); no webServer entry here on purpose, so a stray port never
 * gets silently reused.
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  retries: 0,
  reporter: [["list"], ["json", { outputFile: "reports/playwright/results.json" }]],
  use: {
    baseURL: "http://127.0.0.1:1420",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
});
