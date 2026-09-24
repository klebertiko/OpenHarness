# CI / security pipeline — completion (2026-09-24)

Closes the ChatGPT share work
(https://chatgpt.com/s/cx_6ab4bebdfa3481919b8e7d417aa7c99f): bar-3 OpenSSF /
GitButler-aligned delivery gates for OpenHarness, plus OpenGrep, Aikido Safe
Chain, CycloneDX, OWASP Dependency-Check, and optional Laya shadow.

## Delivered on disk

| Artifact | Role |
| --- | --- |
| `.github/workflows/ci.yml` | Frontend, backend, Rust/Tauri, website, Compose → `CI / Required` |
| `.github/workflows/security.yml` | Dependency-review, CodeQL, OpenGrep 1.22.0, Trivy, Gitleaks, zizmor → `Security / Required` |
| `.github/actions/setup-safe-chain/action.yml` | Aikido Safe Chain 1.5.15 with SHA-256 verify (Unix + Windows) |
| `.github/workflows/sbom.yml` | CycloneDX for root/frontend/website npm, backend pip, Tauri cargo |
| `.github/workflows/owasp.yml` | Dependency-Check 12.1.8; opens tracking issue on CVSS ≥ 7 |
| `.github/workflows/scorecard.yml` | OpenSSF Scorecard SARIF → Code Scanning |
| `.github/workflows/security-monitor.yml` | Scheduled npm / pip-audit / cargo-audit + issue upsert |
| `.github/workflows/release.yml` | Tag `vX.Y.Z` → reusable CI+Security → Windows NSIS + smoke + attestations |
| `.github/workflows/laya-shadow.yml` | Advisory issue triage only (`ENABLE_LAYA_SHADOW`); never merge authority |
| `.github/dependabot.yml` | npm ×3, pip, cargo, github-actions |
| `.github/CODEOWNERS` | `@klebertiko` on `*`, `.github/`, sandbox/security/Tauri surfaces |
| `docs/ci-security.md` | Policy + admin checklist |
| `scripts/laya_issue_shadow.py` | Non-authoritative Laya Router evidence writer |
| `SECURITY.md` | Private vulnerability reporting |

## Finish-pass changes (this session)

- Applied `cargo fmt` to `src-tauri/src/lib.rs` (was documented baseline failure).
- Cleared frontend ESLint unused-import / unused-prop debt so `npm run lint` is green.
- Linked README → `docs/ci-security.md`.
- Expanded admin checklist in `docs/ci-security.md`.

## Explicitly out of scope (unchanged)

- Laya production authority / merge decisions — shadow only; promotion bar stays in `docs/ci-security.md`.
- Desktop sidecar crash / HITL packaging beyond what `release.yml` already smoke-tests.
- Authenticode / EV signing (documented as remaining before production distribution).
- Git commit / push — files remain untracked or dirty until HITL asks to commit.

## HITL next (admin + git)

1. Review and commit the `.github/**` pack + finish-pass fixes on a dedicated PR (do not mix with unrelated dirty harness/desktop WIP unless intentional).
2. After merge to `main`, run the admin checklist in `docs/ci-security.md`.
3. Optionally set `ENABLE_LAYA_SHADOW=true` only when collecting advisory artifacts.
