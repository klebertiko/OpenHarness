# Sidecar binaries

Tauri `externalBin` expects platform-suffixed files, e.g.:

- `openharness-sidecar-x86_64-pc-windows-msvc.exe`
- `openharness-sidecar-x86_64-apple-darwin`
- `openharness-sidecar-aarch64-apple-darwin`
- `openharness-sidecar-x86_64-unknown-linux-gnu`

Build the FastAPI sidecar with PyInstaller (or embed a portable Python) and
copy the artifact here with the correct target triple suffix. Until then,
`tauri dev` / `tauri build` will warn that the sidecar is missing — UI still
loads against an externally started `uvicorn` on `http://127.0.0.1:8000`.
