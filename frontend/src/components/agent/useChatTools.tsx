"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { chatToolsApi, type ChatCapabilities, type DiscoverItem } from "@/lib/chatToolsApi";
import type { ChatToolsInput } from "./chatCommands";

/**
 * What the `/` menu knows about the selected workspace (contract v1.1 §2.1,
 * §2.2). Re-fetched when the workspace or the chat connection changes. On
 * any broker error the menu simply has no tools — the composer says why —
 * and the chat keeps working as text.
 */
export function useChatTools(
  workspace: { rootPath: string; name: string } | null,
  connectionId?: string
): ChatToolsInput & { error: string | null; loading: boolean } {
  const root = workspace?.rootPath ?? null;
  const name = workspace?.name ?? null;
  const [capabilities, setCapabilities] = useState<ChatCapabilities | null>(null);
  const [items, setItems] = useState<DiscoverItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setCapabilities(null);
    setItems([]);
    setError(null);
    if (!root) return;
    setLoading(true);
    (async () => {
      try {
        const caps = await chatToolsApi.capabilities(root, connectionId);
        if (cancelled) return;
        setCapabilities(caps);
        if (caps.tools.discover) {
          const found = await chatToolsApi.discover(root);
          if (!cancelled) setItems(found.items);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [root, connectionId]);

  const readSkill = useCallback(
    async (path: string) => {
      if (!root) throw new Error("no-workspace");
      const res = await chatToolsApi.read(root, path);
      return res.content;
    },
    [root]
  );

  return useMemo(
    () => ({
      workspace: root && name !== null ? { root, name } : null,
      capabilities,
      items,
      readSkill,
      error,
      loading,
    }),
    [root, name, capabilities, items, readSkill, error, loading]
  );
}
