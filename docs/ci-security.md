# CI, security, and release policy

OpenHarness uses independent quality, security, supply-chain, and release workflows. Probabilistic classifiers never decide whether code may merge or ship.

## Required branch checks

Protect `main`, require pull requests and code-owner review, dismiss stale approvals, block force pushes/deletion, and require these stable checks:

- `Quality / required`
- `Security scan / required`

Enable GitHub Code Scanning, Dependabot alerts, dependency graph, secret scanning with push protection, private vulnerability reporting, and immutable releases in repository settings. GitHub settings are not created by workflow files and must be enabled by an administrator.

## Coverage

| Workflow | Display name | Purpose | Merge blocking |
| --- | --- | --- | --- |
| `ci.yml` | Quality | frontend, backend, Rust/Tauri, website, Compose | Yes |
| `security.yml` | Security scan | Dependency review, CodeQL, OpenGrep, Trivy, Gitleaks, Zizmor; failed scanners upsert Issues | Yes |
| `scorecards.yml` | Scorecards supply-chain security | OpenSSF repository posture | Scheduled evidence |
| `sbom.yml` | SBOM CycloneDX | CycloneDX SBOMs for npm, Python and Cargo | Main/scheduled evidence |
| `owasp.yml` | OWASP Dependency-Check | OWASP Dependency-Check defense in depth | Scheduled; opens an issue on failure |
| `security-monitor.yml` | Dependency audit | npm, pip and RustSec audits | Scheduled; opens an issue on failure |
| `release.yml` | Release | version gate, NSIS build, smoke, checksum, SBOM and attestations | Tag-only release gate |
| `laya-shadow.yml` | Laya triage | optional issue-triage research artifact | Never |

Failed security scanners open or update a deterministic GitHub Issue via `.github/scripts/upsert-security-issue.sh` (title + fingerprint). SARIF uploads to Code Scanning remain the alert surface; Issues are the work-tracking surface.

All external Actions are pinned to full commit SHAs. Dependabot proposes reviewed pin updates. Checkout credentials are not persisted. Jobs receive the smallest practical permissions, and issue-writing/release-writing jobs are separated from scanners.

## Aikido Safe Chain

Package installation in CI passes through Aikido Safe Chain 1.5.15. The versioned installer is downloaded and verified against its published SHA-256 before execution. Safe Chain supplements lockfiles and vulnerability scanners; it does not replace them.

## Releases

Create an annotated `vX.Y.Z` tag only after synchronizing the version in:

- `package.json`
- `frontend/package.json`
- `website/package.json`
- `src-tauri/Cargo.toml`
- `src-tauri/tauri.conf.json`

Configure a protected GitHub Environment named `release` with required reviewer approval. A release is built on `windows-2025`, smoke-checked, checksummed, described by a CycloneDX SBOM, and signed with GitHub build-provenance and SBOM attestations. Verify a downloaded asset with:

```bash
gh attestation verify OpenHarness_*_x64-setup.exe --repo klebertiko/OpenHarness
```

GitHub attestations prove where the artifact came from; they do not replace Windows Authenticode. Before treating releases as production distribution, configure an EV certificate or Azure Artifact Signing and sign both the packaged application binaries and the final NSIS installer. Keep that credential path inside the protected `release` environment and fail the release when signature verification fails.

## Laya experiment

Set repository variable `ENABLE_LAYA_SHADOW=true` only when intentionally collecting issue-triage evidence. The workflow has read-only permissions and emits an artifact marked `authority: advisory-shadow`. It cannot label, comment, close, prioritize, suppress security findings, influence required checks, or authorize a release.

Promotion beyond shadow mode requires a versioned, human-labelled PT/EN corpus with immutable train/calibration/held-out splits; a deterministic baseline; per-class precision/recall and macro-F1; ECE/Brier calibration; drift and latency measurements; and predeclared abstention thresholds. High-impact and ambiguous cases remain human decisions.

## Website deploy (GitHub Pages)

`.github/workflows/pages.yml` publishes `website/` to https://klebertiko.github.io/OpenHarness/ with the official Actions flow: `configure-pages` → `npm run build:pages` → `upload-pages-artifact` → `deploy-pages`. It runs on pushes to `main` that touch `website/**` or the workflow itself, and on `workflow_dispatch`. The build installs no npm dependencies (`build-pages.mjs` uses Node built-ins), so Safe Chain is not needed there. The build job has `contents: read` + `pages: read`; only the deploy job gets `pages: write` + `id-token: write`, inside the `github-pages` environment (deployment branches: `main`, `gh-pages`). `concurrency: pages` never cancels a running deploy.

PRs cannot break the site silently: the Quality `website` job already runs `npm run build:pages`, `test:publication`, `test:i18n` and `test:security` on every PR.

Edit the site only in `website/` on `main`. Do not commit to `gh-pages` by hand.

**Cut-over (one time, repo owner):**

1. Merge the PR that adds `pages.yml`. While Pages is still in legacy mode (branch `gh-pages`), that first run may fail at `deploy`; the old site keeps serving.
2. Settings → Pages → Build and deployment → Source: **GitHub Actions**.
3. Actions → Pages → Run workflow on `main` (or re-run the failed run). Confirm the `deploy` job is green and that `/`, `/en/`, `model.html`, `manifesto.html` (both languages) return 200 with the current content.
4. Keep the `gh-pages` branch as a fallback until step 3 is verified. Rollback: switch Source back to "Deploy from a branch" → `gh-pages` / root. Delete `gh-pages` only after the owner decides it is no longer needed.

## Current baseline failures

None known after the 2026-09-24 finish pass (`cargo fmt` on `src-tauri/src/lib.rs` and frontend ESLint unused-import cleanup). Treat the next CI run on GitHub as the live baseline — fix findings in ordinary reviewed changes. Do not weaken a gate merely to make it green.

## Admin checklist (not in git)

After these workflows land on the default branch:

1. Protect `main` with the ruleset in `.github/rulesets/main.json` (merge queue, required checks, linear history, no force-push/deletion; no required reviewers).
2. Require status checks: `Quality / required`, `Security scan / required`.
3. Enable Code Scanning, Dependabot alerts, dependency graph, secret scanning + push protection, private vulnerability reporting.
4. Create protected Environment `release` with required reviewers.
5. Optionally set `ENABLE_LAYA_SHADOW=true` only when collecting advisory issue-triage artifacts.
6. Optional: `NVD_API_KEY` repository secret for faster OWASP NVD sync.
