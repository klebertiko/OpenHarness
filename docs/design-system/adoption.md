# Adoption

How the app reaches this system without a rewrite. Counts below were measured in `frontend/src` on 2026-10-22 with a grep, not estimated.

## Principle

First the tokens mirror exactly what the code does today: parity, zero visual change, proved by `npm test`. After that, each correction that changes pixels goes in its own pull request labelled **visual change**, with before and after in both themes, so the change is seen at merge.

## Wiring

- `frontend/src/app/globals.css` stays the runtime source of the variables until the Tailwind 4 `@theme` migration (#120) lands. `docs/design-system/tokens.json` is the spec it must match, name for name: `scripts/design-tokens.mjs --check` fails on any value that differs, any variable `globals.css` declares that no token maps to, and any theme override the tokens do not describe. After #120, update the `css` mapping in the tokens (and the parser's block selectors) to the `@theme` names; the contract does not change.
- `tokens.json` marks every token with a status: `code` (mirrors a variable in `globals.css`), `hardcoded` (the value lives in a component, no variable yet), `tailwind` (comes from the Tailwind scale) or `proposed` (new, not yet in the app).
- Components in `frontend/src/components/ui/` do not exist yet. A reference implementation (React, vanilla classic script, tokens only) is kept in `docs/design-system/reference/` with a local preview page; the real components arrive in a separate pull request with tests and a catalogue page, and are not adopted in `agent/`, `providers/` or `agent-run/` until the owners of those modules coordinate.

## Drift found in the app

| Finding | Where | Decision |
| --- | --- | --- |
| ~~Fonts are named but never loaded~~ | `globals.css` `--font-ui`, `--font-mono` | **Done** in `frontend/src/app/fonts.ts`: Sora 400/500/600 and IBM Plex Mono 400/500 self-hosted with `next/font/local` (woff2, `latin` subset, SIL OFL 1.1 licences beside the files), `font-display: swap`, fallback with generated `size-adjust` and `ascent-override`. `latin-ext` is not shipped: `next/font/local` has no `unicode-range`, so a second file would load on every page. Revisit when a locale needs it. |
| `design.md` said cards 10px and controls 7px; code ships 4, 6 and 8 | `design.md` vs `--r-*` | Code is v1; `design.md` now states the code's radii. "Radii 10 and 7" stays an open decision for a future visual comparison. Do not change radius on your own. |
| Hardcoded radii 12, 14 and 18px | composer, prompt card, Studio welcome | Tokens `radius-composer` (14) and `radius-hero` (18) record them; fold or justify later. |
| 67 uses of `text-[12px]`, 38 of `text-[11px]`, 23 of `text-[13px]`, 4 of `text-[15px]`, 3 of `text-[14px]` | across `src` | 12 is `t-body`, 13 is `t-title`. `t-meta` is 11px in the target (fractional sizes blur and differ by DPI); the code ships 10.5px today, so the change belongs in the typography visual-change pull request. |
| 30 uses of `rounded-[1px]` and 4 of `rounded-[2px]` | across `src` | Off the scale. Use `radius-control` or none, in a visual-change pull request. |
| Four ink levels in code, three in `design.md` | `--ink-*` | `ink-faint` stays for decoration only; reading text uses three. |
| Raw hex in one file | `src/app/dev/v/[slot]/page.tsx` | Dev route; replace with tokens or exclude. |
| Known contrast defects | `ink-faint`, `line` as a control edge, `warn` and `fault` as text, `signal` as text in Ivory on `sub-200`, `role-tool` on Graphite | Measured in the README. Proposed tokens `line-strong`, `warn-text`, `fault-text`, `signal-text` meet the bar on all four substrates; `ink-faint` and `role-tool` need new values. Visual-change pull request. |

## Guardrails

- **Parity test.** `frontend/src/design-system/tokens.test.ts` runs `scripts/design-tokens.mjs --check` and checks the README contrast table is current. It only reads `globals.css`; it never writes it.
- **Contrast.** `scripts/check-contrast.mjs` exits non-zero when a required pair falls below 4.5:1 (text) or 3:1 (control edges, focus rings, marks) in either theme.
- **Lint (later).** Forbid arbitrary Tailwind values for colour, radius and font size (`text-[…]`, `rounded-[…]`, `bg-[#…]`), with an allow-list for layout.
- **Visual (later).** A catalogue page per component state in both themes, with Playwright snapshots.
- **Review.** A change to a token is a change to `tokens.json` first, then `globals.css`, in one pull request.

## Status and next steps

Done in this pull request: tokens in DTCG format, the brand book, the experience contract, the Nilo rulebook, parity and contrast checks, `design.md` aligned to the code, and a reference implementation of Button, Input, Badge, Panel, ListRow, Kbd and Nilo (rendered and checked by eye in both themes; Playwright snapshots are not in yet).

1. Visual change, after #120: fonts self-hosted and preloaded, theme set before paint, contrast corrections, `t-meta` to 11px, with before and after in both themes.
2. Components in `frontend/src/components/ui/` (Button, Input, Badge, Panel, ListRow, Kbd) with vitest and accessibility tests, plus a `/dev/design-system` catalogue page and Playwright snapshots in both themes.
3. Adoption in existing screens, coordinated with the owners of each module.
