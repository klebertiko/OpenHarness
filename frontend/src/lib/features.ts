/**
 * Build-time feature flags. One flag per unfinished capability, each flipped in
 * the slice that makes the capability real — never to preview dead UI.
 */

/**
 * Studio Copilot (spec: docs/superpowers/specs/2026-10-04-studio-copilot-design.md).
 * Off: the Studio overview leads with New harness and renders no describe box.
 * On: the overview leads with "Describe the harness you want…" and hands the text to
 * `startCopilotFromOverview` (lib/copilotEntry.ts). Copilot slice S3 turns this on
 * in the same change that implements that entry point.
 */
export const COPILOT_ENABLED = true;
