# App icons (required for `tauri build` and CI cargo)

Committed into git so `tauri::generate_context!` succeeds in CI without a
separate icon-generation step. When Nilo's grid changes, regenerate from the
repo root:

```bash
node scripts/brand-icons.mjs
```

That refreshes `32x32.png`, `128x128.png`, `128x128@2x.png`, `icon.ico`, and
`icon.icns`. Prefer that over `tauri icon`, which downsamples one big PNG and
blurs the sprite.
