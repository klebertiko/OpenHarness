# Screen audit

Measured on 2026-10-22 against `rebrand/oharness` (commit `50c7797`), before any change in this branch. Reproduce with `node frontend/scripts/audit-screens.mjs` (see the header of the script): it walks every state below in Graphite and Ivory at 1440×900 and 390×844, runs axe-core (WCAG 2.2 AA + best practices), and records console errors, hit-target sizes, loaded fonts and overflow. Screenshots of this baseline are in [`before/`](./before). The sidecar was running with an empty database, so lists are in their empty state. The unreachable-sidecar state was checked separately by pointing the app at a closed port (results under *Sidecar unreachable*).

Baseline checks before the work: `eslint --max-warnings=0` clean, `tsc --noEmit` clean, `vitest` 118 files / 908 tests passing, `design-tokens --check` parity ok, `check-contrast` ok with the documented known defects.

## Routes and screens

The app is one route (`/`) whose destination is held in `useShellStore.section`; `/dev/*` routes are internal fixtures. The screens are therefore destinations plus overlays.

| # | Screen | Where | Audited states |
| --- | --- | --- | --- |
| S1 | Shell (header, rail, status bar) | `components/shell/*` | all screens |
| S2 | Chats | `agent/AgentStage`, `ChatComposer`, `ThreadsSidebar` | empty, no provider |
| S3 | Studio overview | `studio/StudioOverview` | empty drafts, bundled starting points |
| S4 | Studio editor | `canvas/*`, `toolbar/Toolbar`, `studio/StudioActionsBar`, `ValidateDock`, `sidebar/*`, `copilot/*` | blank draft |
| S5 | Providers | `providers/ProvidersList`, `Dossier` | nothing connected, usage endpoint |
| S6 | Command palette | `shell/CommandPalette` | open, both themes |
| S7 | Keyboard map | `shell/KeymapSheet` | open |
| S8 | Harness library sheet | `shell/HarnessLibrarySheet`, `harnesses/HarnessLibrary` | not reachable from the empty states audited; read from source |

## Summary

| Screen | axe (dark desktop) | axe (light desktop) | Console errors | Small targets (<24px) | Horizontal overflow at 390px |
| --- | --- | --- | --- | --- | --- |
| Chats | clean | `color-contrast` ×2 | 1 (404) | 2 | none |
| Palette | `color-contrast` ×5 | `color-contrast` ×13 | 0 | 2 | none |
| Keymap | `color-contrast` ×1 | `color-contrast` ×9 | 0 | 2 | none |
| Studio overview | clean | `color-contrast` ×5 | 0 | 0 | carousel clips 38 elements by design, page itself does not scroll |
| Studio editor | `page-has-heading-one`, `region` | + `color-contrast` ×14 | 1 (React Flow attribution warning) | **9** | toolbar and status bar clip |
| Providers | `color-contrast` ×1, `heading-order` | `color-contrast` ×18, `heading-order` | 0 | 1 | none |

Ivory is markedly worse than Graphite everywhere: the contrast defects in the README table reach the screen.

## Defects across the app (found on every screen)

| ID | Defect | Evidence | Fix |
| --- | --- | --- | --- |
| X1 | **Fonts never load.** `--font-ui` names Sora and `--font-mono` names IBM Plex Mono, but there is no `@font-face` or `next/font`; `document.fonts` reports nothing loaded, so the interface renders in the system font and the mono data in a fallback. | audit: `loadedFonts: []` on all 24 states | Phase 1: `next/font/local`, woff2, metrics override, no CDN |
| X2 | **Theme is set after hydration** by an effect in `ActivityRail`; an Ivory user sees a Graphite flash and `theme-color` follows the OS, not the choice. | source: `ActivityRail.tsx` `useEffect` | Phase 1: inline script in `<head>` sets `data-theme` before paint, `color-scheme` and `theme-color` follow it |
| X3 | **`text-ink-faint` carries reading text** (counts, hints, meta, shortcut captions) and fails AA on every ground in Ivory and on `sub-300` in Graphite. | axe `color-contrast`, README table | new `ink-faint` values; reading text moves to `ink-mute` |
| X4 | **`text-warn` / `text-fault` as text**: 3.3:1 (`warn`, Ivory) and 3.6:1 (`fault`, Graphite). | Providers dossier alerts, status badges | `warn-text`, `fault-text` + icon or word |
| X5 | **`signal` as text on `sub-200` in Ivory** (4.3:1) and links in `sub-300`. | `.text-signal` links | `signal-text` |
| X6 | **`line` is the edge of controls** (inputs, secondary buttons, checkboxes) at 1.6:1. | axe does not flag it; measured by the contrast script | `line-strong` for control edges |
| X7 | **No focus ring contract.** 19 `outline-none` sites, ring is `ring-1` on some controls, absent on the composer textarea wrapper, tab stops inside dialogs are unringed. | grep + keyboard walk | one `:focus-visible` rule: solid 2px `signal`, offset 2px |
| X8 | **Typography is arbitrary**: 163 `text-[Npx]` uses (9.5, 10, 10.5, 11, 12, 13, 14, 15), 58 arbitrary radii. Rendered font sizes on one screen: 9.5, 10.5, 11, 12, 13, 14, 48px. | computed styles | `t-*` scale (11px `t-meta`), radius tokens |
| X9 | **Hit targets under 24px**: composer link buttons are 16–17px tall, Studio toolbar buttons are 20–22px. | audit | `control-sm/md/lg` heights; 36px on narrow layouts |
| X10 | **Header names the wrong thing**: Chats and Providers both show `Agent` as the context label (`AppShell` passes `mode="Agent"`). | screenshots | header names the destination |
| X11 | **Mixed language**: the composer's permission copy is Portuguese (`pede aprovação · Shift+Tab`, the Auto and trust notices) in an English product. | `ChatComposer.tsx` | English, tests updated |
| X12 | **Dev-only**: the Next.js dev indicator overlaps "Hide panel" at the bottom of the rail in dev. Not shipped (static export). | screenshots | none; noted so it is not mistaken for a layout bug |
| X13 | **Machine-flavoured microcopy**: status bar reads `mode Studio · exec mock · section studio · graph 0n · 0e`, palette footer `every action lives here`, count `08` in the palette. | screenshots | plain words, measured values only |
| X15 | **No favicon**: `GET /favicon.ico` is a 404 on every load. | console | Phase 1: icon from `brand/` via the metadata API |
| X14 | **Reading size.** Conversation text is 13px; the system asks for `t-reading` 14/1.6 in a column of 60–68ch. | computed styles | `t-reading` |

## Per screen

### S1 Shell

- Header `Agent` label (X10); the product name and Nilo mark are fine. Search button shows `Ctrl K` as two `kbd`s with contrast failures in Ivory (X3).
- Below 640px the rail collapses to 52px and the header context clips the document name to `Untitled harr…` beside the search icon; the Studio editor adds a second 48px toolbar row (`Run · Mock/Connected · undo/redo · save/export/import`) that clips at 390px with no overflow affordance.
- Status bar (24px) is `mono`, uppercase `READY`, and clips at 390px (`mode · exec`, `section studio`, `graph …`). It repeats what the header and canvas already say (X13).
- Rail: `aria-current` present; hover uses amber (`nilo-beak`) at 14% which reads as a different colour for the same state; labels fine. Icon-only collapsed items rely on `title` only.
- No skip link; the document has one landmark `main` but the status bar `footer` and header are not labelled.

### S2 Chats (Quiet Desk)

- Empty state is good structurally (display line, three starters, composer). Defects: display text is 48px rather than `t-display`; Nilo sits right of the heading and overlaps the reading column at 1440px; the starter list uses `ink-mute` icons with no name on the group.
- The composer is the only region with Portuguese strings (X11). `Connect a provider to send` appears twice (as an inline link and next to the send button), both 16–17px tall (X9); the send button is disabled with no reason in place other than the adjacent link.
- Permission mode switch (`Ask / Auto / Plan`) is a segmented control of plain buttons without `aria-pressed` or a group name — verify in source during the rebuild.
- Left panel `Chats` lists `No chats yet…` (fine) and `New chat` (fine). No loading skeleton while threads hydrate (layout jumps once threads arrive).
- Textarea focus is shown by the wrapper only when the wrapper itself is focused; keyboard users get no 2px ring (X7).

### S3 Studio overview (Graph Workshop, step 1)

- Layout is the strongest screen. Defects: the `Draft with Nilo` button is disabled (low-contrast fill) with no reason until text is entered; `Ctrl ↵ to draft` caption is `ink-faint` (X3); `Open .ohm` and `New harness` are different button families (outlined vs ghost).
- Starting-points carousel: prev/next buttons are 24px, the cards clip at the right edge with no fade or count, and keyboard focus does not scroll cards into view. At 390px the 38 clipped elements are the next cards.
- Empty `Your harnesses` is a dashed box: acceptable, but copy says `OHM` and `.ohm` in the same sentence set.
- `Bundled harness` labels use mono `ink-faint` at 11px (X3).

### S4 Studio editor

- **Two stacked toolbars plus a third action row plus a bottom dock**: `Run · mode · undo/redo · save/export/import` (top), `Back · title · Draft · Not saved yet · Ask Nilo · Use in chat` and `New · Open bundled harness · Import · Export · Discard · Delete draft · Save · Save as…` (StudioActionsBar), and `Validate · Plan simulation · Export .ohm · Import .ohm` (ValidateDock). Export and Import each appear three times with three different names (`Export`, `Export graph JSON (advanced)`, `Export .ohm`). Both Save and Save as… are filled primary.
- Nine controls under 24px (`Run`, `Mock`, `Connected`, undo/redo and three icon buttons, `? keys`) (X9); mode toggle `Mock / Connected` is a segmented control with no group label.
- Heading structure: no `h1` (`page-has-heading-one`); the draft title is an `h2`, the palette `Blocks` an `h2`. A hidden file `<input>` has no name.
- Palette: `Mc…` is truncated (`MCP`) at 216px; port counts `1 in · 1 out` are `ink-faint` (X3). Role squares are fine.
- Canvas: React Flow attribution is hidden and logs a console warning in dev; empty hint says `import an OHM file below` which points at a dock that repeats the same action.
- At 390px the actions bar wraps to six lines and pushes the canvas below the fold; the bottom dock wraps; the status bar clips.
- Contrast in Ivory: 14 nodes (panel meta, node port labels, dock captions).

### S5 Providers (Curated Library)

- First provider selected is `OpenRouter` (index of the last "Needs setup" row) instead of the first in the list; the dossier header is sticky but its bottom border overlaps the first section rule (a double line).
- `heading-order`: the list uses `h2` then `h3` group names while the dossier starts at `h1`; sections inside the dossier are `h3` under an `h1` (skips `h2`).
- `text-warn` badge `no model chosen` fails in Ivory (X4); `Spend … No budget — set one` is a 18px button (X9); alert paragraphs use `text-warn` (X4).
- Facts row (`Runs on · Answers to · Billed as · Reachability · Spent`) overflows into two columns at 390px; fine. A `--------` placeholder glyph stands for "never reached" (decorative; reads as a bug).
- At 390px the list becomes a native `<select>` above the dossier: works, but loses group names and status.
- Missing: loading state for `usage/summary` (a 503/blocked sidecar only logs a CORS-looking console error), explicit error state for the connections request.

### S6 Command palette

- Selected row uses `sub-300` with `ink-primary` plus a 2px `signal` bar: passes in Graphite, fails in Ivory for the secondary mono caption (`chats`, `studio`) and group labels (X3). `kbd` caps are `ink-faint` on `sub-100`.
- The count (`08`) and footer (`every action lives here`) are decoration (X13). Group labels are uppercase mono — allowed only as a single `t-label` word per group, which they are, but at `ink-faint`.
- The dialog does not announce result count to assistive tech and has no `aria-live` result summary; no empty-results message was verified.

### S7 Keyboard map

- `Kbd` pieces use `ink-faint` captions; two columns collapse to one at 390px but the sheet is not scrollable at short heights (verify). Focus returns to the opener — verify in the rebuild.

### S8 Harness library sheet

- Source-read only. Uses the legacy `ListRow` and `Panel` from `components/shell/`, which are the files the new `ui/` components replace.

## Sidecar unreachable

Checked by pointing `window.__OH_API__` at a closed port, in Graphite at desktop width.

| Screen | What the person sees | Defect |
| --- | --- | --- |
| Chats | The composer shows `Loading…` and `Couldn't load harnesses` at the same time; the provider chip says `Auto · No available provider`; nothing says the sidecar is unreachable or offers Retry. | A contradictory state (E1). Loading never resolves into one message. |
| Studio | `Couldn't reach the local engine, so saved harnesses can't be listed right now.` in a `role=alert`. | Good copy; keep and reuse the pattern. |
| Providers | The list renders as if nothing is wrong; the dossier shows `Not connected` for a provider whose real state is unknown; the only signal is `Usage may be stale: Failed to fetch` (raw browser message). | State is invented rather than unknown (E2); raw error text (E3). |

Console noise: 7 to 13 failed-resource errors per screen are the browser's own network log; the app handles them, but only Studio says so. On a healthy sidecar, the only error is a 404 for `/favicon.ico` (the app ships no favicon, X15) and the hidden React Flow attribution warning in Studio.

## Order of work

1. Foundation: fonts, theme-before-paint, tokens and corrected values, `ui/` components, a11y test harness, focus rule.
2. Shell and navigation (X10, X13, rail, header, status bar, palette, keymap, sheets).
3. Chats.
4. Studio overview and editor (toolbar consolidation).
5. Providers.
6. Sweep: arbitrary sizes and radii, `ink-faint` reading text, re-run this audit, update README contrast table.
