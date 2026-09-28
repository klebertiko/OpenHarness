import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  esbuild: {
    jsx: "automatic",
  },
  test: {
    environment: "happy-dom",
    // e2e/** holds Playwright specs (worktree-only, contract v1.1/rollup
    // gate evidence) — vitest's default glob would otherwise try to collect
    // them and fail on test.describe() from the wrong test runner.
    exclude: ["**/node_modules/**", "e2e/**", ".stryker-tmp/**"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
