import { newStudioHarness } from "@/lib/studio";
import { flushAutosave } from "@/lib/studioDocuments";
import { useCopilotStore } from "@/store/copilotStore";

/**
 * The Studio overview's single hand-off into the Copilot.
 *
 * The overview's describe box (shown only when `COPILOT_ENABLED` in lib/features.ts)
 * calls `startCopilotFromOverview(prompt)` with the trimmed description and nothing
 * else. This is the only overview-to-editor transition, so autosave, canvas reset,
 * panel opening, and the initial request cannot drift into separate UI paths.
 *
 * Contract (plan: docs/superpowers/plans/2026-10-04-studio-copilot.md § S3):
 *   1. `await flushAutosave()` so the current document is saved first.
 *   2. Start an empty harness (`newStudioHarness()`), which opens the editor.
 *   3. `useCopilotStore.getState().openCopilot()` and `send(prompt)`.
 *   Resolve once the editor is open; reject with a person-readable `Error.message`
 *   when Copilot cannot start (the overview renders that message as an alert).
 */

export async function startCopilotFromOverview(prompt: string): Promise<void> {
  const description = prompt.trim();
  if (!description) throw new Error("Describe the harness first.");
  await flushAutosave();
  newStudioHarness();
  const copilot = useCopilotStore.getState();
  copilot.openCopilot();
  void copilot.send(description);
}
