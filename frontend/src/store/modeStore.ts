"use client";

import { create } from "zustand";

export type ShellMode = "agent" | "studio";

export interface ModeState {
  mode: ShellMode;
  setMode: (mode: ShellMode) => void;
}

export const useModeStore = create<ModeState>((set) => ({
  mode: "agent",
  setMode: (mode) => set({ mode }),
}));
