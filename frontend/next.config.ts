import type { NextConfig } from "next";

/**
 * Static export for the Tauri webview (ADR 0001).
 *
 * Production has **no Next.js server**: no rewrites, no `app/api` proxies.
 * The UI talks to the FastAPI sidecar via `src/lib/apiBase.ts`
 * (`window.__OH_API__` or loopback). Dev (`next dev`) also uses apiBase →
 * sidecar; optional reference proxies live under `dev-proxies/` (not built).
 */
const nextConfig: NextConfig = {
  output: "export",
  reactStrictMode: true,
  images: { unoptimized: true },
  // The dev overlay badge floats over the app's own bottom-left corner, where
  // the canvas controls live. Off, so the shell's chrome is the only chrome.
  devIndicators: { buildActivity: false, appIsrStatus: false },
};

export default nextConfig;
