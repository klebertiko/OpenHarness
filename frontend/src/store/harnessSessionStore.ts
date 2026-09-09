"use client";

import { create } from "zustand";

export const HARNESS_SESSION_KEY = "oh.harnessSession";

/** Minimal bundle shape for session state (full graph arrives later). */
export interface HarnessBundle {
  manifest: { id: string };
}

export interface HarnessSessionPersisted {
  enabled: boolean;
  activeBundleId: string | null;
}

export interface HarnessSessionState {
  enabled: boolean;
  activeBundle: HarnessBundle | null;
  hydrated: boolean;
  setEnabled: (enabled: boolean) => void;
  setActiveBundle: (bundle: HarnessBundle | null) => void;
  replaceBundle: (bundle: HarnessBundle) => void;
  hydrate: () => Promise<void>;
}

function readPersisted(): Partial<HarnessSessionPersisted> {
  if (typeof localStorage === "undefined") return {};
  try {
    const raw = localStorage.getItem(HARNESS_SESSION_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Partial<HarnessSessionPersisted>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writePersisted(enabled: boolean, activeBundleId: string | null): void {
  if (typeof localStorage === "undefined") return;
  const payload: HarnessSessionPersisted = { enabled, activeBundleId };
  localStorage.setItem(HARNESS_SESSION_KEY, JSON.stringify(payload));
}

function persistFromState(get: () => HarnessSessionState): void {
  const { enabled, activeBundle } = get();
  writePersisted(enabled, activeBundle?.manifest.id ?? null);
}

export const useHarnessSessionStore = create<HarnessSessionState>((set, get) => ({
  enabled: true,
  activeBundle: null,
  hydrated: false,

  setEnabled: (enabled) => {
    set({ enabled });
    persistFromState(get);
  },

  setActiveBundle: (bundle) => {
    set({ activeBundle: bundle });
    persistFromState(get);
  },

  replaceBundle: (bundle) => {
    set({ activeBundle: bundle });
    persistFromState(get);
  },

  hydrate: async () => {
    const persisted = readPersisted();
    const enabled =
      typeof persisted.enabled === "boolean" ? persisted.enabled : get().enabled;

    const res = await fetch("/bundles/default");
    if (!res.ok) {
      throw new Error(`Failed to load default harness: ${res.status}`);
    }
    const bundle = (await res.json()) as HarnessBundle;
    if (!bundle?.manifest?.id) {
      throw new Error("Default harness missing manifest.id");
    }

    set({
      enabled,
      activeBundle: bundle,
      hydrated: true,
    });
    writePersisted(enabled, bundle.manifest.id);
  },
}));
