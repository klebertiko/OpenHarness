import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { useChatTools } from "./useChatTools";

// CHAT-TOOLS-FE AC#1/#5 — the composer's `tools` input comes from the broker
// for the selected workspace (contract v1.1 §2.1/§2.2), never from a fixed list.

const capabilities = {
  workspace: { root: "D:\\Development", name: "Development" }, provider_kind: "http", reason: "ok",
  tools: { discover: true, read: true, exec: true }, preset: { read: true, exec: true }, limits: {},
};
const discover = { root: "D:\\Development", items: [{ kind: "command", name: "test", path: "package.json", argv: ["npm", "run", "test"], source: "package-scripts" }], truncated: false, scanned_dirs: 3 };

function stub(routes: Record<string, unknown>) {
  const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => {
    const key = Object.keys(routes).find((k) => String(url).includes(k));
    if (!key) return new Response(JSON.stringify({ error: "not_found" }), { status: 404 });
    return new Response(JSON.stringify(routes[key]), { status: 200 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.unstubAllGlobals());

it("loads capabilities and discover for the selected workspace", async () => {
  const fetchMock = stub({ "/chat/tools/capabilities": capabilities, "/chat/tools/discover": discover });
  const { result } = renderHook(() => useChatTools({ rootPath: "D:\\Development", name: "Development" }, "ollama"));
  await waitFor(() => expect(result.current.items).toHaveLength(1));
  expect(result.current.workspace).toEqual({ root: "D:\\Development", name: "Development" });
  expect(result.current.capabilities?.preset.exec).toBe(true);
  const urls = fetchMock.mock.calls.map((c) => String(c[0]));
  expect(urls.some((u) => u.includes("/chat/tools/capabilities?") && u.includes("connection_id=ollama"))).toBe(true);
});

it("No workspace hides tools and says why", async () => {
  const fetchMock = stub({});
  const { result } = renderHook(() => useChatTools(null, "ollama"));
  expect(result.current.workspace).toBeNull();
  expect(result.current.items).toEqual([]);
  expect(fetchMock).not.toHaveBeenCalled();
});

it("degrades to no tools when the broker is unavailable, without throwing", async () => {
  stub({});
  const { result } = renderHook(() => useChatTools({ rootPath: "D:\\Development", name: "Development" }));
  await waitFor(() => expect(result.current.error).toBeTruthy());
  expect(result.current.workspace?.name).toBe("Development");
  expect(result.current.capabilities).toBeNull();
  expect(result.current.items).toEqual([]);
});

it("readSkill goes through POST /chat/tools/read and returns the content", async () => {
  const fetchMock = stub({ "/chat/tools/capabilities": capabilities, "/chat/tools/discover": discover, "/chat/tools/read": { path: "x/SKILL.md", bytes: 3, truncated: false, encoding: "utf-8", content: "abc", redactions: 0 } });
  const { result } = renderHook(() => useChatTools({ rootPath: "D:\\Development", name: "Development" }));
  await waitFor(() => expect(result.current.capabilities).not.toBeNull());
  await expect(result.current.readSkill("x/SKILL.md")).resolves.toBe("abc");
  const readCall = fetchMock.mock.calls.find((c) => String(c[0]).includes("/chat/tools/read"))!;
  expect(JSON.parse(String((readCall[1] as RequestInit).body))).toEqual({ cwd: "D:\\Development", path: "x/SKILL.md" });
});
