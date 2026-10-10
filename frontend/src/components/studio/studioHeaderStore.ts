"use client";
import { create } from "zustand";

/**
 * Which confirmation row the editor header is showing (Save as, Discard,
 * Delete). It lives in a store, not in the header's state, so the command
 * palette can ask for the same confirmation the File menu does.
 */
export type HeaderPending = null | "saveas" | "discard" | "delete";

interface HeaderStore {
  pending: HeaderPending;
  setPending: (pending: HeaderPending) => void;
}

export const useStudioHeaderStore = create<HeaderStore>((set) => ({
  pending: null,
  setPending: (pending) => set({ pending }),
}));
