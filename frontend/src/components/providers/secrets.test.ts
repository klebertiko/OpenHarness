import { beforeEach, describe, expect, it, vi } from "vitest";
import { activeVault, saveSecret, type SecretRef } from "./secrets";

const RAW = "sk-proj-SUPERSECRETVALUE0aT7";

describe("secrets.saveSecret", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    // Ensure no Tauri invoke is present in the test DOM.
    delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  });

  it("POSTs plaintext to backend and returns only a SecretRef", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ secretRef: "openharness/openai" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const ref = await saveSecret("openharness/openai", RAW);

    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:8000/providers/openai/secret",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: RAW }),
      })
    );

    expect(ref).toEqual(
      expect.objectContaining<Partial<SecretRef>>({
        service: "openharness/openai",
        prefix: "sk-proj-",
        tail: "0aT7",
        length: RAW.length,
        vault: "backend",
      })
    );

    // Client-held shape must never carry the pasted material.
    expect(JSON.stringify(ref)).not.toContain("SUPERSECRET");
    expect(ref).not.toHaveProperty("key");
    expect(ref).not.toHaveProperty("value");
    expect(ref).not.toHaveProperty("plaintext");
    expect(Object.keys(ref).sort()).toEqual(
      ["length", "prefix", "savedAt", "service", "tail", "vault"].sort()
    );
  });

  it("ensures connection then retries when secret POST returns 404", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 404 })
      .mockResolvedValueOnce({ ok: true, status: 201 }) // create connection
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ secretRef: "openharness/ollama-cloud" }),
      });
    vi.stubGlobal("fetch", fetchMock);

    const ref = await saveSecret("openharness/ollama-cloud", "sk-or-cloudkeyZZ99");

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock).toHaveBeenNthCalledWith(1, "http://127.0.0.1:8000/providers/ollama-cloud/secret", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: "sk-or-cloudkeyZZ99" }),
    });
    expect(fetchMock).toHaveBeenNthCalledWith(2, "http://127.0.0.1:8000/providers/connections", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: "ollama-cloud", provider: "ollama", label: "ollama-cloud",
        residence: "cloud", endpoint: "", enabled: false,
      }),
    });
    expect(fetchMock).toHaveBeenNthCalledWith(3, "http://127.0.0.1:8000/providers/ollama-cloud/secret", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: "sk-or-cloudkeyZZ99" }),
    });
    expect(ref.service).toBe("openharness/ollama-cloud");
    expect(ref.vault).toBe("backend");
    expect(JSON.stringify(ref)).not.toContain("cloudkey");
  });

  it("falls back to memory vault when backend is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));

    const ref = await saveSecret("openharness/openai", RAW);

    expect(ref.vault).toBe("memory");
    expect(ref.service).toBe("openharness/openai");
    expect(JSON.stringify(ref)).not.toContain("SUPERSECRET");
  });

  it("activeVault prefers backend outside Tauri", () => {
    expect(activeVault()).toBe("backend");
  });
});
