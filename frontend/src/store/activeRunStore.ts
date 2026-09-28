"use client";

import { create } from "zustand";
import { sendControl } from "@/components/agent-run/runClient";

/**
 * Shared handle for the in-flight run so the palette / toolbar Stop verb can
 * hit `/api/run/[id]/control` instead of only flipping a local boolean.
 */
export interface ActiveRunState {
  runId: string | null;
  setRunId: (runId: string | null) => void;
  /** Stop via control API when a run id is known. Returns whether a request was sent. */
  requestStop: () => Promise<boolean>;
}

export const useActiveRunStore = create<ActiveRunState>((set, get) => ({
  runId: null,

  setRunId: (runId) => set({ runId }),

  requestStop: async () => {
    const { runId } = get();
    if (!runId) return false;
    await sendControl(runId, { action: "stop" });
    return true;
  },
}));
