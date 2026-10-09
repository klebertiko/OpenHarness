import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/lib/copilot/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/copilot/api")>();
  return { ...actual, assistField: vi.fn() };
});

import { assistField } from "@/lib/copilot/api";
import { useProviderStore, type Connection } from "@/components/providers/providerStore";
import { useCanvasStore } from "@/store/canvasStore";
import { useChatProviderStore } from "@/store/chatProviderStore";
import { FieldAssist } from "./FieldAssist";

const mockAssist = vi.mocked(assistField);
const conn = (over: Partial<Connection>): Connection =>
  ({
    id: "c1", provider: "anthropic", label: "Claude", residence: "cloud", endpoint: "", secret: null, health: "live",
    detail: "", probes: [], facts: [], models: [], defaultModel: "", route: [], routeSort: "price", allowed: [], enabled: true, lastProbe: "", ...over,
  }) as Connection;
const initial = { providers: useProviderStore.getState(), chat: useChatProviderStore.getState() };

beforeEach(() => {
  mockAssist.mockReset();
  useChatProviderStore.setState({ chosenId: null });
  useCanvasStore.setState({ isRunning: false, _history: [], _historyIndex: -1 });
  useCanvasStore.getState().loadGraph([{ id: "n", type: "agent", position: { x: 0, y: 0 }, data: { label: "Reviewer", systemPrompt: "" } }], []);
});
afterEach(() => {
  cleanup();
  useProviderStore.setState(initial.providers);
  useChatProviderStore.setState(initial.chat);
});

async function draft() {
  const user = userEvent.setup();
  render(<FieldAssist nodeId="n" field="systemPrompt" />);
  await user.click(screen.getByRole("button", { name: "Assist" }));
  await user.type(screen.getByRole("textbox", { name: "What should it do?" }), "review prs");
  await user.click(screen.getByRole("button", { name: "Draft" }));
}

describe("FieldAssist provider wiring", () => {
  it("passes live mode and the connection id when a provider is ready", async () => {
    useProviderStore.setState({ connections: [conn({ id: "claude-1" })] });
    mockAssist.mockResolvedValue({ text: "t", notes: [], source: "model", tokens: 3 });
    await draft();
    expect(mockAssist.mock.calls[0][0]).toMatchObject({ mode: "live", connection_id: "claude-1" });
    expect(await screen.findByText("t")).toBeTruthy();
    expect(screen.queryByText("Offline draft")).toBeNull();
  });

  it("passes local mode for an on-device provider", async () => {
    useProviderStore.setState({ connections: [conn({ id: "ol", provider: "ollama", residence: "local", endpoint: "http://127.0.0.1:11434/v1", defaultModel: "llama3" })] });
    mockAssist.mockResolvedValue({ text: "t", notes: [], source: "model", tokens: 3 });
    await draft();
    expect(mockAssist.mock.calls[0][0]).toMatchObject({ mode: "local", connection_id: "ol" });
  });

  it("silently goes offline with no provider, and the result is tagged by the backend source", async () => {
    useProviderStore.setState({ connections: [conn({ enabled: false, health: "setup" })] });
    mockAssist.mockResolvedValue({ text: "You are the Reviewer agent.", notes: [], source: "offline", tokens: 0 });
    await draft();
    expect(mockAssist.mock.calls[0][0]).toMatchObject({ mode: "mock", connection_id: null });
    expect(await screen.findByText("Offline draft")).toBeTruthy();
  });

  it("never falls back to another connection when the chosen one is unavailable", async () => {
    useProviderStore.setState({ connections: [conn({ id: "ready" }), conn({ id: "off", enabled: false, health: "setup" })] });
    useChatProviderStore.setState({ chosenId: "off" });
    mockAssist.mockResolvedValue({ text: "t", notes: [], source: "offline", tokens: 0 });
    await draft();
    expect(mockAssist.mock.calls[0][0]).toMatchObject({ mode: "mock", connection_id: null });
  });
});
