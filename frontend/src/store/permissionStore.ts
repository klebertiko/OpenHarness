"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { DEFAULT_PERMISSION_MODE, isPermissionMode, type PermissionMode } from "@/lib/permissionMode";

export const PERMISSION_STORAGE_KEY = "oh.permission.v1";

/**
 * Permission mode per conversation. This is a cache for display: the sidecar
 * holds (and enforces) the real value. The no-thread `draft` belongs to the
 * next conversation and is never persisted, so a new conversation always
 * starts on `ask`.
 */
interface PermissionState {
  byThread: Record<string, PermissionMode>;
  draft: PermissionMode;
  modeFor: (threadId: string | null) => PermissionMode;
  setMode: (threadId: string | null, mode: PermissionMode) => void;
  resetDraft: () => void;
  forget: (threadId: string) => void;
}

export const usePermissionStore = create<PermissionState>()(
  persist(
    (set, get) => ({
      byThread: {},
      draft: DEFAULT_PERMISSION_MODE,
      modeFor: (threadId) => (threadId ? get().byThread[threadId] ?? DEFAULT_PERMISSION_MODE : get().draft),
      setMode: (threadId, mode) =>
        threadId ? set({ byThread: { ...get().byThread, [threadId]: mode } }) : set({ draft: mode }),
      resetDraft: () => set({ draft: DEFAULT_PERMISSION_MODE }),
      forget: (threadId) => {
        const { [threadId]: _dropped, ...rest } = get().byThread;
        void _dropped;
        set({ byThread: rest });
      },
    }),
    {
      name: PERMISSION_STORAGE_KEY,
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ byThread: state.byThread }),
      merge: (persisted, current) => {
        const raw = (persisted as { byThread?: unknown } | undefined)?.byThread;
        const byThread: Record<string, PermissionMode> = {};
        if (raw && typeof raw === "object") {
          // An unknown stored value is dropped (-> ask), never trusted.
          for (const [id, mode] of Object.entries(raw)) if (isPermissionMode(mode)) byThread[id] = mode;
        }
        return { ...current, byThread };
      },
    }
  )
);
