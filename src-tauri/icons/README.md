# App icons (required for `tauri build`)

Generate from a source PNG once Rust / `@tauri-apps/cli` are installed:

```bash
npm run tauri -- icon path/to/app-icon-1024.png
```

That writes `32x32.png`, `128x128.png`, `128x128@2x.png`, `icon.icns`, and
`icon.ico` into this folder. Scaffold commits do not invent binary icon blobs.
