/**
 * The Studio overview's single hand-off into the Copilot.
 *
 * The overview's describe box (shown only when `COPILOT_ENABLED` in lib/features.ts)
 * calls `startCopilotFromOverview(prompt)` with the trimmed description and nothing
 * else. Until Copilot slice S3 lands, it rejects with `CopilotUnavailableError` and the
 * overview shows that message; the person's text stays in the box.
 *
 * Contract for S3 (plan: docs/superpowers/plans/2026-10-04-studio-copilot.md § S3):
 *   1. `await flushAutosave()` so the current document is saved first.
 *   2. Start an empty harness (`newStudioHarness()`), which opens the editor.
 *   3. `useCopilotStore.getState().openCopilot()` and `send(prompt)`.
 *   Resolve once the editor is open; reject with a person-readable `Error.message`
 *   when Copilot cannot start (the overview renders that message as an alert).
 *   Then flip `COPILOT_ENABLED` to true.
 */

export class CopilotUnavailableError extends Error {
  constructor() {
    super("Copilot isn't available yet.");
    this.name = "CopilotUnavailableError";
  }
}

export async function startCopilotFromOverview(prompt: string): Promise<void> {
  if (!prompt.trim()) throw new Error("Describe the harness first.");
  throw new CopilotUnavailableError();
}
