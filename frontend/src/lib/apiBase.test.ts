import { afterEach, beforeEach, expect, it, vi } from "vitest";

/**
 * SEC gate 2026-09-24 (gates/sec-fe-2026-09-24.md, P2-FE-2): the fetch patch
 * decided whether to attach the sidecar's bearer token by `url.startsWith(
 * apiBase())` — a string prefix check, not an origin check. A URL like
 * `http://127.0.0.1:8000@attacker.tld/x` satisfies that prefix (userinfo
 * before `@`) while the browser actually sends the request to
 * `attacker.tld`. Not exploitable *today* only because every connection's
 * endpoint happens to be loopback; `openai`/`ollama` connections have
 * `endpoint.editable: true` (catalog.ts), so this is one config change away
 * from leaking the sidecar token to an attacker-controlled host.
 *
 * The module patches `window.fetch` once, at import time — so each test
 * resets modules and re-imports to get a fresh patch over a fresh mock.
 */

async function freshApiBase(env: Record<string, string | undefined> = {}) {
  vi.resetModules();
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) vi.stubEnv(k, "");
    else vi.stubEnv(k, v);
  }
  (window as unknown as { __ohFetchPatched__?: boolean }).__ohFetchPatched__ = false;
  (window as unknown as { __OH_TOKEN__?: string }).__OH_TOKEN__ = "secret-token-abc";
  return import("./apiBase");
}

let calls: Array<{ url: string; headers: Headers }>;
let nativeFetch: typeof window.fetch;

beforeEach(() => {
  calls = [];
  nativeFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    calls.push({ url, headers: new Headers(init?.headers) });
    return new Response("{}");
  });
  window.fetch = nativeFetch;
});

afterEach(() => {
  vi.unstubAllEnvs();
  delete (window as unknown as { __OH_TOKEN__?: string }).__OH_TOKEN__;
});

it("attaches the bearer token for a real same-origin sidecar call", async () => {
  await freshApiBase();
  await window.fetch("http://127.0.0.1:8000/providers/connections");
  expect(calls[0].headers.get("Authorization")).toBe("Bearer secret-token-abc");
});

it("never attaches the token to a different host, even one sharing the sidecar's origin as a string prefix", async () => {
  await freshApiBase();
  // Userinfo syntax: the browser sends this to attacker.tld, not 127.0.0.1 —
  // but it starts with "http://127.0.0.1:8000" character-for-character.
  await window.fetch("http://127.0.0.1:8000@attacker.tld/x");
  expect(calls[0].headers.get("Authorization")).toBeNull();
});

it("still attaches the token for a sidecar path, not just the bare origin", async () => {
  await freshApiBase();
  await window.fetch("http://127.0.0.1:8000/chat/tools/read");
  expect(calls[0].headers.get("Authorization")).toBe("Bearer secret-token-abc");
});

it("never attaches the token to an unrelated host that merely starts with a similar string", async () => {
  await freshApiBase();
  await window.fetch("http://127.0.0.1:8000.attacker.tld/x");
  expect(calls[0].headers.get("Authorization")).toBeNull();
});
