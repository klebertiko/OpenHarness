# OpenHarness

OpenHarness is an Agent + Harness Design Studio desktop app — the successor to
Harness Simulator. Design, validate, and run agent harness graphs against a
compiled skills-framework bundle.

Public bundle standard: [`docs/harness-spec/README.md`](docs/harness-spec/README.md)

## Single install path (Windows)

Desktop packaging uses **Tauri v2 + NSIS** (`src-tauri/tauri.conf.json` →
`bundle.targets: ["nsis"]`). The installer embeds the static Next export, the
FastAPI sidecar binary, and `resources/default-agile.oharness`.

### Prerequisites

1. Rust toolchain (`rustup`) + MSVC Build Tools
2. WebView2 (Windows 10/11 usually already have it)
3. Node 20+ and Python 3.12+
4. Generate app icons once (scaffold does not ship binary icons):

```bash
cd frontend && npm install
cd .. && npm install
npm run tauri -- icon path/to/app-icon-1024.png
```

5. Build / place the sidecar under `src-tauri/binaries/` with the correct
   target-triple suffix (see `src-tauri/binaries/README.md`).

### Build the installer

```bash
# 1) Static UI (no Next server in prod)
cd frontend && npm run build && cd ..

# 2) NSIS installer via Tauri
npm run tauri:build
```

Expected artifact (after a successful local build):

`src-tauri/target/release/bundle/nsis/OpenHarness_*_x64-setup.exe`

This repository does **not** claim that `tauri build` has been verified in CI
on this branch — run the commands above on a machine with Rust + icons +
sidecar present. Until then, use the local dev loop below.

### Dev loop (no installer)

```bash
# Terminal A — FastAPI sidecar
cd backend && python -m uvicorn main:app --host 127.0.0.1 --port 8000

# Terminal B — Next (static export still talks via apiBase / __OH_API__)
cd frontend && npm run dev
```

Or, with icons + sidecar ready: `npm run tauri:dev` from the repo root.

Secrets backend for the sidecar:

| `OH_SECRETS` | Store |
|---|---|
| `memory` (default) | Process lifetime |
| `file` | Fernet files under `OH_SECRETS_DIR` or `~/.openharness/secrets` |
| `keychain` | OS keychain (`pip install keyring`) |

## Validate a harness

```bash
cd backend && python -m oharness validate oharness/fixtures/default-agile.oharness
```

Default harness id: `openharness.default.agile`

## Smoke checklist (HITL)

After installing from a local NSIS build:

1. Launch OpenHarness → default Agile harness on
2. Studio validate → Agent toggle off/on
3. Quit → confirm sidecar ports are free (`scripts/desktop-shutdown.mjs`)
