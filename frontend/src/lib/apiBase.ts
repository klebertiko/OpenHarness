/**
 * Resolve the FastAPI sidecar base URL.
 *
 * Production (Tauri static export) has **no Next.js server** — rewrites and
 * `app/api/*` proxies do not exist. The UI talks to the sidecar on loopback.
 *
 * Preference order:
 *   1. `window.__OH_API__` — injected by the Tauri shell at startup
 *   2. `NEXT_PUBLIC_API_URL` / `OPENHARNESS_BACKEND_URL` (build-time / env)
 *   3. Default sidecar loopback (`http://127.0.0.1:8000`)
 */

declare global {
  interface Window {
    /** Injected by Tauri before the UI loads, e.g. `http://127.0.0.1:18765`. */
    __OH_API__?: string;
  }
}

const DEFAULT_SIDECAR = "http://127.0.0.1:8000";

function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

/** Absolute origin of the FastAPI sidecar (no trailing slash). */
export function apiBase(): string {
  if (typeof window !== "undefined" && typeof window.__OH_API__ === "string") {
    const injected = window.__OH_API__.trim();
    if (injected) return stripTrailingSlash(injected);
  }

  const env =
    process.env.NEXT_PUBLIC_API_URL?.trim() ||
    process.env.OPENHARNESS_BACKEND_URL?.trim();
  if (env) return stripTrailingSlash(env);

  return DEFAULT_SIDECAR;
}

/** Join sidecar base with a path that starts with `/`. */
export function apiUrl(path: string): string {
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${apiBase()}${p}`;
}
