"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

/**
 * The chat's default provider — level 2 of the provider↔harness rule
 * (docs/product/provider-harness-rule.md). `chosenId` is a provider connection
 * id the person picked in the composer chip; `null` means "Auto" (let
 * pickChatProvider choose the first connected one). It's a session default, not
 * per-thread.
 */
export interface ChatProviderState {
  chosenId: string | null;
  setChosen: (id: string | null) => void;
}

export const CHAT_PROVIDER_STORAGE_KEY = "oh.chat.provider.v1";

export const useChatProviderStore = create<ChatProviderState>()(
  persist(
    (set) => ({
      chosenId: null,
      setChosen: (chosenId) => set({ chosenId }),
    }),
    {
      name: CHAT_PROVIDER_STORAGE_KEY,
      storage: createJSONStorage(() => localStorage),
    },
  ),
);
