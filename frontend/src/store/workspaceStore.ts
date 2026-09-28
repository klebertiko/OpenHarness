"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { coworkApi, type CoworkProject } from "@/lib/coworkApi";

/**
 * The chat's working folder — mirrors `chatProviderStore`'s shape exactly
 * (a session default, not per-thread; `null` means "no folder", degrading
 * honestly to the app-owned scratch directory every CLI adapter already
 * falls back to via `cli_shared.resolve_cwd` when no cwd is threaded
 * through). Reuses the existing Cowork project concept (`cowork_projects`
 * table, `coworkApi`) rather than inventing a parallel "workspace" entity —
 * a project's `rootPath` *is* the working folder.
 */
export interface WorkspaceState {
  projects: CoworkProject[];
  hydrated: boolean;
  chosenProjectId: string | null;

  hydrate: () => Promise<void>;
  refresh: () => Promise<void>;
  setChosen: (id: string | null) => void;
  /** Registers a folder as a Cowork project and selects it. Returns the new
      project's id, or `null` if the sidecar rejected/couldn't reach it —
      the caller decides how to surface that, this never throws. */
  addProject: (input: { name: string; rootPath: string }) => Promise<string | null>;
}

export const WORKSPACE_STORAGE_KEY = "oh.chat.workspace.v1";

export const useWorkspaceStore = create<WorkspaceState>()(
  persist(
    (set, get) => ({
      projects: [],
      hydrated: false,
      chosenProjectId: null,

      hydrate: async () => {
        if (get().hydrated) return;
        set({ hydrated: true });
        await get().refresh();
      },

      refresh: async () => {
        try {
          const { projects } = await coworkApi.list();
          set({ projects });
        } catch {
          // Sidecar unreachable at mount — the picker just shows "no
          // projects yet" rather than a broken list; the chip itself still
          // degrades to "No folder" either way.
        }
      },

      setChosen: (chosenProjectId) => set({ chosenProjectId }),

      addProject: async ({ name, rootPath }) => {
        try {
          const project = await coworkApi.create({ name, rootPath });
          set((state) => ({
            projects: [project, ...state.projects.filter((p) => p.id !== project.id)],
            chosenProjectId: project.id,
          }));
          return project.id;
        } catch {
          return null;
        }
      },
    }),
    {
      name: WORKSPACE_STORAGE_KEY,
      storage: createJSONStorage(() => localStorage),
      // Only the person's *choice* is a durable preference — the project
      // list itself is always re-fetched fresh, never trusted from a stale
      // cache (a project could be renamed/deleted between sessions).
      partialize: (state) => ({ chosenProjectId: state.chosenProjectId }),
    },
  ),
);

/** The chosen project's row, or null for "no folder" / a stale/deleted id. */
export function chosenWorkspace(state: WorkspaceState): CoworkProject | null {
  if (!state.chosenProjectId) return null;
  return state.projects.find((p) => p.id === state.chosenProjectId) ?? null;
}
