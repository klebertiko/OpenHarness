<p align="center">
  <img src="website/assets/mark.svg" width="128" alt="OHarness mark" />
</p>

<h1 align="center">OHarness</h1>

<p align="center">
  <strong>Agent + Harness Design Studio</strong> for your desktop.<br />
  Design the crew. Wire the gates. Run against <em>your</em> providers.
</p>

<p align="center">
  <a href="https://klebertiko.github.io/oharness/">Product site (pt-BR)</a>
  ·
  <a href="https://klebertiko.github.io/oharness/en/">English</a>
  ·
  <a href="https://github.com/klebertiko/oharness/releases/tag/v0.0.1-alpha">Download</a>
  ·
  <a href="docs/harness-spec/README.md">OHM format</a>
  ·
  <a href="docs/ci-security.md">CI &amp; security</a>
  ·
  <a href="SECURITY.md">Vulnerability reporting</a>
</p>

<p align="center">
  <img alt="Status" src="https://img.shields.io/badge/status-public%20preview-3AB3AD?style=flat-square" />
  <img alt="Platforms: Windows, Linux, macOS" src="https://img.shields.io/badge/desktop-Windows%20%C2%B7%20Linux%20%C2%B7%20macOS%20(Tauri%20v2)-161412?style=flat-square" />
  <img alt=".ohm: YAML adopted, Studio import and export still JSON" src="https://img.shields.io/badge/.ohm-YAML%20adopted%2C%20Studio%20I%2FO%20still%20JSON-D9A441?style=flat-square" />
  <img alt="Node" src="https://img.shields.io/badge/node-22-339933?style=flat-square&logo=node.js&logoColor=white" />
  <img alt="Python" src="https://img.shields.io/badge/python-3.12-3776AB?style=flat-square&logo=python&logoColor=white" />
</p>

---

## Download

**Pre-release `v0.0.1-alpha`**: [github.com/klebertiko/oharness/releases/tag/v0.0.1-alpha](https://github.com/klebertiko/oharness/releases/tag/v0.0.1-alpha). Installers for Windows (x64), Linux (AppImage and `.deb`, x86_64) and macOS (Apple silicon and Intel). Until the pre-release is published, that page returns 404. Link the tag, not `/releases/latest`: GitHub never serves a pre-release from `latest`.

**The installers are unsigned.** Windows SmartScreen ("Windows protected your PC") and macOS Gatekeeper warn on first launch; details and the exact steps are in [`docs/ci-security.md`](docs/ci-security.md#code-signing). Verify every download before running it, in the folder with the files (use the file you downloaded in the second command):

```bash
sha256sum --check --ignore-missing SHA256SUMS
gh attestation verify OHarness-windows-x64-setup.exe --repo klebertiko/oharness
```

Attestations prove where a file was built; they do not replace a publisher signature. Alpha quality: read the limitations in [`docs/release-notes/v0.0.1-alpha.md`](docs/release-notes/v0.0.1-alpha.md) ([pt-BR](docs/release-notes/v0.0.1-alpha.pt-BR.md)).

### System requirements

> **Below the minimum, the interface renders broken, with no warning.** The UI uses Tailwind CSS 4 (migration in PR #120), which requires Chrome 111, Safari 16.4 or Firefox 128 or newer because of `@property` and `color-mix()` ([Tailwind docs](https://tailwindcss.com/docs/upgrade-guide)). On macOS and Linux the app renders in the system WebView; if that is older, the layout breaks and the app shows no message. On Windows, WebView2 tracks the current Edge and meets the minimum.

| System | Minimum |
| --- | --- |
| Windows | Windows 10 or 11, 64-bit (x64) only, with the WebView2 Runtime (Evergreen). Windows 11 includes it; Windows 10 from version 1803 already ships it (Tauri docs). If it is missing, the NSIS installer downloads the WebView2 bootstrapper and needs an internet connection. Windows 7, 8 and 8.1 do not qualify: their WebView2 stopped at Edge 109. |
| macOS | macOS 13.3 or newer, Apple silicon (arm64) or Intel (x64), one native installer each (not universal). 13.3 is the defensible floor: macOS 13.0 to 13.2 ship Safari 16.1 to 16.3, without `@property`. Today this is documentation only: declaring it in the installer (`LSMinimumSystemVersion`) is in PR #167 and takes effect only after it; until then macOS does not stop the app from opening on an older version. |
| Linux | x86_64 (64-bit), WebKitGTK 2.40 or newer (`webkit2gtk-4.1`) and glibc 2.35 or newer (Ubuntu 22.04+, Debian 12+, Fedora 36+, per the comment in `release.yml`). Ubuntu 22.04 without updates ships WebKitGTK 2.36, below the floor; with security updates it ships 2.50.x. The `.deb` depends on `libwebkit2gtk-4.1-0` and, after PR #167, on `(>= 2.40)`; before that it requires no version. |

**Not verified:** Apple does not literally state that macOS 13.3 ships Safari 16.4 (secondary source only); whether an app's WKWebView on macOS 12 or earlier gets a manually installed Safari 16.4; the real minimum (`minos`) of the packaged macOS binaries, including the PyInstaller sidecar, which may be higher than 13.3; what macOS does exactly when it opens an app below `LSMinimumSystemVersion`; that WebKitGTK 2.40 is equivalent to Safari 16.4 with `@property` enabled by default (2.40 is a plausible floor, not a proven one); whether the AppImage carries its own WebKit (per the Tauri bundler's code it does; our file was not inspected); the effect of `(>= 2.40)` on the generated `.deb`; the WebKitGTK version of Fedora 36 and of distros not listed. The installers are unsigned: download only from the [tag page](https://github.com/klebertiko/oharness/releases/tag/v0.0.1-alpha), never `/releases/latest`, and run `sha256sum --check --ignore-missing SHA256SUMS` and `gh attestation verify <file> --repo klebertiko/oharness` first.

---

## What this is

OHarness is a **desktop application** (Tauri v2 + FastAPI sidecar) where you author and run **agent harnesses** — composed systems of Agents, Gates, HITL checkpoints, Skills, and Signals — against the providers you connect: Anthropic and OpenAI through their local CLIs, OpenRouter with an API key, Ollama (local or cloud), and Cursor for delegated agent tasks. See [Providers](#providers).

The portable format is the **OHarness Model (OHM)**: a `.ohm` bundle, authored in YAML 1.2 ([ADR 0003](docs/adr/0003-ohm-yaml.md)). Three harnesses ship bundled so you can open the app and see a full crew immediately. Each opens as an editable copy:

| Harness | Id | Source |
| --- | --- | --- |
| **Agile Harness** (the default) | `oharness.default.agile` | Compiled from the `engineering/harness` skill in `skills-framework` |
| **DeepSeek Harness** | `oharness.example.deepseek-harness` | [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness), desktop release `dsh-v0.2.1-alpha.2` |
| **Matt Pocock skills** | `oharness.example.mattpocock-skills` | [mattpocock/skills](https://github.com/mattpocock/skills) |

The last two model published projects and cite their sources in their descriptions; they set no provider and ship no secrets. Every user authors and shares their own harnesses — the bundled ones are starting points, not the product.

Nilo is the front door — a small presence who greets you and answers what she can. When a request needs the crew, she starts the loaded harness. She is not a role in the crew.

---

## Product surfaces

<p align="center">
  <img src="website/assets/canvas-light.webp" width="720" alt="Studio — harness canvas" />
</p>

<p align="center"><em>Studio</em> — the Agile Harness on the canvas after auto-arrange, with the validation badge reporting one node not wired.</p>

<p align="center">
  <img src="website/assets/chats-light.webp" width="720" alt="Chats — Nilo, empty state" />
</p>

<p align="center"><em>Chats</em> — the empty state: Nilo, the Ask / Auto / Plan modes, the harness picker, and a prompt to connect a provider.</p>

The app has three destinations, reachable with `Alt+1` to `Alt+3`.

| Surface | Intent |
| --- | --- |
| **Chats** (`Alt+1`) | Direct runs and harness-bound conversations. Chat tools (`/exec`, `/read`, `/ls`) run through the sidecar; `/exec` waits for your approval. Composer chips pick the provider for the chat and the workspace folder it works in (no folder runs in a scratch directory). |
| **Studio** (`Alt+2`) | Visual harness authoring, validation, mock/live modes. Describe a flow to Nilo or open a bundled harness. |
| **Providers** (`Alt+3`) | The roster of connections — cloud, local, CLI. See [Providers](#providers). |

**Removed:** Automate and Pull requests no longer exist. The `/automations` and `/repos` routes are gone (breaking change, #31).

### Studio files

Starting points on the Studio overview are "Agent + review" and the bundled harnesses above, each with an "Open harness: …" button. The editor bar shows the harness name, where it came from (Bundled harness, Draft or Saved harness) and whether it has unsaved changes.

| Action | What it does |
| --- | --- |
| New, Open bundled harness, Import, Export | Start a blank harness, open a bundled harness as an editable copy (the bundled one is never changed), import or export a `.ohm`. In the desktop app, Export opens the native Save dialog. |
| Save / Save as… | Save writes a harness you already own. On an unedited bundled harness it creates an editable copy. Save as always creates a new harness and opens the copy. |
| Discard / Delete | Discard drops a draft, or returns a saved harness to its last saved version. Delete removes a draft or a saved harness. Both ask for confirmation. |
| Use in chat | Makes the open harness the one the chat runs. |

### Nilo in Studio

In Studio, **Ask Nilo** (or `Mod+I`) opens a side panel where you describe a flow in plain language and Nilo, the OHarness assistant, proposes graph edits: nodes added, wired and configured. The proposal appears as a list of changes you **Keep** or **Undo**; applying it is one undoable step, and every change is validated against the graph rules before it reaches the canvas. With a connected provider the request goes to that model (one repair attempt on an invalid reply). With none, a deterministic offline planner answers instead, and the result is tagged *Offline draft*. In the Inspector, **Assist** drafts, improves or reviews the free-text fields of agents, skills and gates, also offline when no provider is ready. Secrets, endpoints, commands and provider ids are never sent. The transcript is session-only and replies are not streamed.

---

## Providers

Five vendors. Anthropic and OpenAI connect through the CLI you are already signed in to, so OHarness stores no key for them.

| Vendor | Connects through | Notes |
| --- | --- | --- |
| **Anthropic** | Local `claude` CLI (`claude login`) | Runs on your Claude subscription. Tool execution is disabled; it answers chat only. |
| **OpenAI** | Local `codex` CLI (`codex login`) | Runs on your ChatGPT subscription. Shell commands go through a read-only sandbox. |
| **OpenRouter** | API key (`sk-or-…`) | You pick a route, an ordered model preference, not a single model. |
| **Ollama** | Local daemon, default `http://127.0.0.1:11434/v1`, no key | Ollama Cloud is a separate connection. |
| **Cursor** | Local `cursor-agent` CLI (`cursor-agent login`) | Agent-only: an LLM node cannot use it, a Delegate node can. On Windows it runs inside WSL2 (distro `Ubuntu-24.04` by default, override with `OHARNESS_CURSOR_WSL_DISTRO`); the native Windows `cursor-agent` stays blocked. |

- **Chat picker.** Lists "Auto" (the first eligible connection, cloud before on-device) and the connections that can answer now. Setup stays on the Providers screen.
- **Per-node pins and failover.** A node can pin an ordered list of connections. If one rejects the call, the next is tried, and the attempts show in the run transcript. A node with no pin uses the chat's choice. If neither resolves, the run stops at that node with an error; it never swaps providers silently. Rule: [`docs/product/provider-harness-rule.md`](docs/product/provider-harness-rule.md).
- **Secrets** are written by the sidecar's secrets store (`OH_SECRETS`, below), never by the Tauri shell.
- **Experimental: Laya.** A local classifier ([ADR 0005](docs/adr/0005-laya-decision-node.md), [ADR 0006](docs/adr/0006-laya-front-door-cascade.md)). It needs a separate Laya process on loopback (`LAYA_LOOPBACK_PORT`, default 8761). With it running, a chat message goes to Laya first to decide between a direct answer and starting the harness; below 0.80 confidence, or when Laya is unavailable, the model-based triage decides as before. The decision is recorded as a `route_decision` event. A Laya `decision` node in a graph is advisory evidence only; no gate, edge or HITL step reads it.

---

## Architecture

```mermaid
flowchart LR
  subgraph Desktop["Desktop"]
    UI["Next.js UI<br/>(static export)"]
    Shell["Tauri v2 shell"]
    UI --- Shell
  end

  subgraph Sidecar["Loopback only"]
    API["FastAPI sidecar<br/>oharness · adapters · secrets"]
  end

  Shell -->|"spawn + health"| API
  UI -->|"HTTP / SSE"| API
  API --> Providers["Your providers"]
  API --> OHM[".ohm bundles"]
  API --> Secrets["OH_SECRETS<br/>memory · file · keychain"]
```

- **Shell** owns the window, WebView, and sidecar lifecycle (port on `127.0.0.1`, process tied to the app).
- **Sidecar** owns execution, OHM validate/run, provider adapters, and credential storage.
- **Credentials never leave your machine** through OHarness cloud — there is none for inference.

Packaging decision: [`docs/adr/0001-desktop-packaging.md`](docs/adr/0001-desktop-packaging.md).

---

## Quick start

### Prerequisites

| Tool | Notes |
| --- | --- |
| **Rust** (`rustup`) + MSVC Build Tools (Windows) | Tauri / WebView2 linkage |
| **WebView2** (Windows) | Usually present on Windows 10/11 |
| **Node.js 22** | See [`.nvmrc`](.nvmrc) |
| **Python 3.12+** | Sidecar |

### Development loop (no installer)

```bash
# Terminal A — sidecar
cd backend
python -m pip install -r requirements.txt
python -m uvicorn main:app --host 127.0.0.1 --port 8000

# Terminal B — UI
cd frontend
npm ci
npm run dev
```

Desktop shell (Tauri) on top of that loop. The shell launches a PyInstaller-built sidecar, so build it first. It lands in `src-tauri/binaries/` with the target-triple suffix Tauri expects:

```bash
npm ci
node scripts/build-sidecar.mjs   # needs backend/.venv or a system python
npm run tauri:dev                # devUrl is http://127.0.0.1:3000 (Terminal B)
```

### Windows installer (local build)

Tagged releases build Windows, Linux and macOS installers in CI (see [Download](#download)). To build the Windows one yourself:

```bash
npm ci
node scripts/build-sidecar.mjs
npm run tauri:build
```

Artifact:

```text
src-tauri/target/release/bundle/nsis/OHarness_*_x64-setup.exe
```

Install the current-user copy and smoke-test it in one step:

```powershell
powershell -File scripts/install-desktop.ps1
```

The script silently installs to `%LOCALAPPDATA%\Programs\OHarness`, refreshes the Windows icon cache, then runs the smoke test against the installed app. The smoke test fails if no sidecar listens on loopback, `/health` is not `ok`, the WebView does not render, the main window does not close, a sidecar process remains after quit, or the app writes `harness.db` or `secrets` into its install directory.

The app is single-instance. The smoke test refuses to run while another OHarness process is open and names the executable to close.

Smoke test on its own:

```powershell
npm run desktop:smoke
# or
powershell -File scripts/smoke-desktop.ps1 -AppPath <path-to-exe>
```

### Secrets backend

| `OH_SECRETS` | Store |
| --- | --- |
| `memory` | Process lifetime (tests / explicit dev) |
| `file` | Default when packaged — Fernet files under `secrets` in the app data folder (`%LOCALAPPDATA%\dev.oharness.app\secrets` on Windows) |
| `keychain` | OS keychain (`pip install keyring`) |

---

## OHarness Model (`.ohm`)

Portable harness bundles: graph, roles, gates, embedded skills/agents/hooks.

| Doc | Purpose |
| --- | --- |
| [`docs/harness-spec/HELLO.md`](docs/harness-spec/HELLO.md) | Minimal valid shape |
| [`docs/harness-spec/README.md`](docs/harness-spec/README.md) | Public entry + schema links |
| [`backend/oharness/fixtures/default-agile.ohm`](backend/oharness/fixtures/default-agile.ohm) | Agile Harness, the product default |
| [`backend/oharness/fixtures/`](backend/oharness/fixtures) | Also `deepseek-harness.ohm` and `mattpocock-skills.ohm` |
| [`docs/adr/0003-ohm-yaml.md`](docs/adr/0003-ohm-yaml.md) | YAML 1.2 authoring profile |

```bash
cd backend
python -m oharness validate oharness/fixtures/default-agile.ohm
```

Default harness id: `oharness.default.agile`. The sidecar lists the bundled harnesses at `GET /bundles/examples` and returns one at `GET /bundles/examples/{id}`.

**YAML status.** The bundled `.ohm` files, the backend codec and the CLI use YAML 1.2. The Studio's Import and Export still read and write JSON text inside the `.ohm` file; the desktop side of the YAML migration is not finished (see [`docs/product/ohm-yaml-migration.md`](docs/product/ohm-yaml-migration.md)).

---

## Repository layout

```text
OHarness/
├── frontend/          Next.js App Router UI (static export for Tauri)
├── backend/           FastAPI sidecar · oharness codec · adapters · sandbox
├── src-tauri/         Tauri v2 shell · NSIS bundle · embedded default .ohm
├── website/           Product site (pt-BR + en) — no backend coupling
├── docs/              ADRs, harness-spec, CI/security policy
├── scripts/           Sidecar build, desktop smoke, advisory Laya shadow
└── .github/           CI, security, SBOM, Scorecard, release, Laya shadow
```

---

## CI, security, and releases

Quality and security are **independent** required checks. Probabilistic classifiers (including optional Laya shadow triage) are **advisory evidence only** — they never decide merge or ship.

| Check | Role |
| --- | --- |
| `Quality / required` | Frontend, backend, Rust, website, Compose |
| `Security scan / required` | Dependency review, CodeQL, OpenGrep, Trivy, Gitleaks, Zizmor |
| Merge queue | Both required workflows also trigger on `merge_group` |
| Scheduled | SBOM CycloneDX, OWASP Dependency-Check, Scorecards supply-chain security, Dependency audit |
| Tag `vX.Y.Z` | Version gate → build matrix (Windows, Linux, macOS arm64 + x64) → smoke → `SHA256SUMS` → SBOM + attestations → **draft** release |

Package installs in CI go through **Aikido Safe Chain** (checksum-pinned installer). External Actions are pinned to full commit SHAs.

Full policy and admin checklist: [`docs/ci-security.md`](docs/ci-security.md).

A tag builds on three operating systems and ends in a **draft** GitHub Release that a maintainer reviews and publishes. A tag with a pre-release suffix (e.g. `v0.0.1-alpha`) is marked pre-release, and GitHub never serves it from `releases/latest`, so link it by tag: `https://github.com/klebertiko/oharness/releases/tag/v0.0.1-alpha`. Asset names are stable and carry no version: `OHarness-windows-x64-setup.exe`, `OHarness-linux-x86_64.AppImage`, `OHarness-linux-amd64.deb`, `OHarness-macos-arm64.dmg`, `OHarness-macos-x64.dmg`, plus `SHA256SUMS` and the SBOM `OHarness-sbom.cdx.json`.

To verify a download, see [Download](#download). GitHub attestations prove provenance; they do not replace Authenticode. EV / Azure Artifact Signing remains a hard requirement before treating builds as production distribution.

---

## Website

Static product pages — no agent execution, no telemetry, loopback-only local server:

```bash
cd website
npm ci
npm run dev          # http://127.0.0.1:4174
```

Published: [klebertiko.github.io/oharness](https://klebertiko.github.io/oharness/) (pt-BR) · [/en/](https://klebertiko.github.io/oharness/en/).

---

## Domain vocabulary (short)

Use these names in issues, PRs, and docs — see [`CONTEXT.md`](CONTEXT.md):

| Term | Meaning |
| --- | --- |
| **OHM** | Portable harness document (`.ohm`) |
| **Harness** | Agents + Gates + HITL + Skills + Signals |
| **Gate** | Blocking checklist with PASS/FAIL routing |
| **HITL** | Human authority (merge, acceptance) — not an Agent |
| **Signal** | Typed exit state on an edge |
| **Provider** | Registered LLM backend with credentials |

---

## Contributing

1. Prefer small PRs against `main` with required checks green.
2. Do not weaken CI/Security gates to force a green run — fix the finding.
3. Desktop changes should pass `npm run desktop:smoke` (Windows; builds with `npm run tauri:build`).
4. OHM changes: validate with `python -m oharness validate` and keep fixtures in sync.

Security reports: [`SECURITY.md`](SECURITY.md) — use GitHub private vulnerability reporting, not public issues.

---

## License

Public preview. Licensing for redistribution will be stated explicitly before a production release; until then treat the tree as source-available for evaluation and contribution under maintainer guidance.

---

<p align="center">
  <img src="website/assets/nilo.svg" width="48" alt="Nilo" /><br />
  <sub>Quiet, warm, precise — Nilo greets; the crew ships.</sub>
</p>
