"use client";
import { create } from "zustand";

/**
 * Shell state — everything about the *frame*, nothing about the graph.
 *
 * Panel geometry is persisted because spatial memory is the whole point of a
 * desktop layout: the app must come back exactly as the user left it.
 */

export type RailSection = "build" | "runs" | "providers" | "files" | "threads";

/** Transient Agent panels opened from the command palette (not persisted). */
export type ShellOverlay = "cowork" | "automations" | "git" | null;

const STORAGE_KEY = "oh.shell.v4";

interface Persisted {
  leftOpen: boolean;
  rightOpen: boolean;
  leftWidth: number;
  rightWidth: number;
  section: RailSection;
}

const DEFAULTS: Persisted = {
  leftOpen: true,
  // Inspector is Studio-only; Agent lands without a dead Session column.
  rightOpen: false,
  leftWidth: 216,
  rightWidth: 264,
  // Agent home = threads master list. Studio still uses `build` / `files`.
  section: "threads",
};

export const LEFT_MIN = 188;
export const LEFT_MAX = 380;
export const RIGHT_MIN = 240;
export const RIGHT_MAX = 460;

function load(): Persisted {
  if (typeof window === "undefined") return DEFAULTS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Persisted>) };
  } catch {
    return DEFAULTS;
  }
}

function save(state: Persisted) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* storage disabled — the layout simply will not persist */
  }
}

interface ShellState extends Persisted {
  hydrated: boolean;
  paletteOpen: boolean;
  keymapOpen: boolean;
  overlay: ShellOverlay;

  hydrate: () => void;
  toggleLeft: () => void;
  toggleRight: () => void;
  setLeftOpen: (v: boolean) => void;
  setRightOpen: (v: boolean) => void;
  setLeftWidth: (w: number) => void;
  setRightWidth: (w: number) => void;
  setSection: (s: RailSection) => void;
  setPaletteOpen: (v: boolean) => void;
  setKeymapOpen: (v: boolean) => void;
  setOverlay: (overlay: ShellOverlay) => void;
  dismissOverlays: () => void;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function persistFrom(s: ShellState) {
  save({
    leftOpen: s.leftOpen,
    rightOpen: s.rightOpen,
    leftWidth: s.leftWidth,
    rightWidth: s.rightWidth,
    section: s.section,
  });
}

export const useShellStore = create<ShellState>((set, get) => ({
  ...DEFAULTS,
  hydrated: false,
  paletteOpen: false,
  keymapOpen: false,
  overlay: null,

  // Read persisted geometry after mount so SSR and first paint agree.
  hydrate: () => set({ ...load(), hydrated: true }),

  toggleLeft: () => {
    set({ leftOpen: !get().leftOpen });
    persistFrom(get());
  },
  toggleRight: () => {
    set({ rightOpen: !get().rightOpen });
    persistFrom(get());
  },
  setLeftOpen: (leftOpen) => {
    set({ leftOpen });
    persistFrom(get());
  },
  setRightOpen: (rightOpen) => {
    set({ rightOpen });
    persistFrom(get());
  },
  setLeftWidth: (w) => {
    set({ leftWidth: clamp(Math.round(w), LEFT_MIN, LEFT_MAX) });
    persistFrom(get());
  },
  setRightWidth: (w) => {
    set({ rightWidth: clamp(Math.round(w), RIGHT_MIN, RIGHT_MAX) });
    persistFrom(get());
  },
  setSection: (section) => {
    set({ section, leftOpen: true });
    persistFrom(get());
  },

  setPaletteOpen: (paletteOpen) => set({ paletteOpen, keymapOpen: false }),
  setKeymapOpen: (keymapOpen) => set({ keymapOpen, paletteOpen: false }),
  setOverlay: (overlay) =>
    set({ overlay, paletteOpen: false, keymapOpen: false }),
  dismissOverlays: () =>
    set({ paletteOpen: false, keymapOpen: false, overlay: null }),
}));
