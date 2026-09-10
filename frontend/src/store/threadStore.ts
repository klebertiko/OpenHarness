"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

export type Thread = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
};

export const THREADS_STORAGE_KEY = "oh.threads.v1";

const DEFAULT_THREAD_TITLE = "New thread";

export interface ThreadState {
  threads: Thread[];
  activeThreadId: string | null;
  createThread: (title?: string) => string;
  selectThread: (id: string) => void;
  renameThread: (id: string, title: string) => void;
}

export const useThreadStore = create<ThreadState>()(
  persist(
    (set, get) => ({
      threads: [],
      activeThreadId: null,

      createThread: (title) => {
        const now = Date.now();
        const id = crypto.randomUUID();
        const thread: Thread = {
          id,
          title: title?.trim() || DEFAULT_THREAD_TITLE,
          createdAt: now,
          updatedAt: now,
        };
        set({
          threads: [thread, ...get().threads],
          activeThreadId: id,
        });
        return id;
      },

      selectThread: (id) => {
        if (!get().threads.some((t) => t.id === id)) return;
        set({ activeThreadId: id });
      },

      renameThread: (id, title) => {
        const trimmed = title.trim();
        if (!trimmed) return;
        const now = Date.now();
        set({
          threads: get().threads.map((t) =>
            t.id === id ? { ...t, title: trimmed, updatedAt: now } : t
          ),
        });
      },
    }),
    {
      name: THREADS_STORAGE_KEY,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        threads: state.threads,
        activeThreadId: state.activeThreadId,
      }),
    }
  )
);
