# Dev-only Next proxies (not built)

These files used to live under `src/app/api/` and proxied the browser to the
FastAPI sidecar during `next dev` / `next start`.

**Production has no Next.js server.** `next.config.ts` sets `output: "export"`;
`npm run build` emits static files into `out/` for the Tauri webview. There are
no rewrites and no Route Handlers in the shipped UI.

Clients resolve the sidecar with `src/lib/apiBase.ts` (`window.__OH_API__` or
`http://127.0.0.1:8000`). Keep this folder as a reference if you ever need a
Node proxy again — do not move it back under `src/app/` while static export is on.
