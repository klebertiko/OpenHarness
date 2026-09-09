# OpenHarness

OpenHarness is an Agent + Harness Design Studio desktop app — the successor to Harness Simulator. Design, validate, and run agent harness graphs against a compiled skills-framework bundle.

## Validate a harness

From the backend package root:

```bash
cd backend && python -m oharness validate oharness/fixtures/default-agile.oharness
```

Default harness id: `openharness.default.agile`

## Installer

A real desktop installer ships later (plan 06 / Tauri). Not available yet — use local `npm` / `python` dev commands until then.
