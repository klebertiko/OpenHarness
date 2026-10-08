"use client";

import { create } from "zustand";

/**
 * A one-shot signal, not state to remember: "open the chat provider combo
 * and, if `id` names a connection, expand its inline setup." Lets a control
 * outside `ChatProviderPicker` (the composer's "what's missing" action,
 * `AgentStage.tsx`) drive the combo's own open/expand state without lifting
 * that state out of the component that owns it, and without the two
 * duplicating how a not-ready connection gets fixed.
 *
 * Deliberately not persisted — unlike `chatProviderStore`'s `chosenId`, a
 * request to open a popover has no business surviving a reload.
 *
 * `token` increments on every call so the same `id` can be requested twice
 * in a row (e.g. the person dismissed the combo and clicked the same
 * missing-action link again) and still fire the effect that reads it.
 */
export interface ChatSetupRequestState {
  token: number;
  id: string | null;
  requestSetup: (id: string | null) => void;
}

export const useChatSetupRequestStore = create<ChatSetupRequestState>((set, get) => ({
  token: 0,
  id: null,
  requestSetup: (id) => set({ id, token: get().token + 1 }),
}));
