import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it } from "vitest";
import { useCanvasStore } from "@/store/canvasStore";
import { useChatProviderStore } from "@/store/chatProviderStore";
import { useProviderStore, type Connection } from "@/components/providers/providerStore";
import { PropertiesPanel } from "./PropertiesPanel";

/**
 * PROVIDER-FAILOVER story, AC#5 (Studio inspector half): the author-facing
 * counterpart to backend/engine.py's `providerIds[1:]` walk. The primary pin
 * (index 0) already had its own test coverage (PropertiesPanel.provider.test.tsx)
 * before this story — these tests cover only the new fallback-ordering UI.
 */
const initialCanvas = useCanvasStore.getState();
const initialProviders = useProviderStore.getState();
const initialChat = useChatProviderStore.getState();
beforeEach(() => {
  useCanvasStore.setState({
    nodes: [
      {
        id: "author",
        type: "agent",
        position: { x: 0, y: 0 },
        data: { label: "Author", roleId: "BE", providerIds: ["an"] },
      },
    ],
    edges: [],
    selectedNodeId: "author",
  });
  useProviderStore.setState({
    connections: [
      { id: "an", label: "Anthropic", enabled: true, health: "setup", secret: null },
      { id: "ol", label: "Ollama local", enabled: true, health: "live", secret: null },
      { id: "oa", label: "OpenAI", enabled: true, health: "live", secret: null },
    ] as Connection[],
  });
  useChatProviderStore.setState({ chosenId: "an" });
});
afterEach(() => {
  cleanup();
  useCanvasStore.setState(initialCanvas);
  useProviderStore.setState(initialProviders);
  useChatProviderStore.setState(initialChat);
});

function providerIds(): (string[] | undefined)[] {
  return useCanvasStore.getState().nodes.map((n) => n.data.providerIds);
}

it("has nothing to add a fallback to until a primary pin is chosen", () => {
  useCanvasStore.setState({
    nodes: [{ id: "author", type: "agent", position: { x: 0, y: 0 }, data: { label: "Author", roleId: "BE" } }],
    edges: [],
    selectedNodeId: "author",
  });
  render(<PropertiesPanel />);
  expect(screen.queryByRole("combobox", { name: /add fallback connection/i })).toBeNull();
});

it("adds a fallback connection after the primary pin, persisted into providerIds[1:]", async () => {
  const user = userEvent.setup();
  render(<PropertiesPanel />);

  await user.selectOptions(screen.getByRole("combobox", { name: /add fallback connection/i }), "ol");
  expect(providerIds()).toEqual([["an", "ol"]]);
});

it("adds a second fallback in the order chosen, and never offers a connection already in the chain", async () => {
  const user = userEvent.setup();
  render(<PropertiesPanel />);

  await user.selectOptions(screen.getByRole("combobox", { name: /add fallback connection/i }), "ol");
  const addSelect = screen.getByRole("combobox", { name: /add fallback connection/i }) as HTMLSelectElement;
  expect(within(addSelect).queryByRole("option", { name: "Anthropic" })).toBeNull();
  expect(within(addSelect).queryByRole("option", { name: "Ollama local" })).toBeNull();

  await user.selectOptions(addSelect, "oa");
  expect(providerIds()).toEqual([["an", "ol", "oa"]]);
});

it("reorders the fallback chain without touching the primary pin", async () => {
  act(() => useCanvasStore.getState().updateNodeData("author", { providerIds: ["an", "ol", "oa"] }));
  render(<PropertiesPanel />);

  await userEvent.setup().click(screen.getByRole("button", { name: /move ollama local down/i }));
  expect(providerIds()).toEqual([["an", "oa", "ol"]]);
});

it("removes one fallback connection, closing the gap and leaving the rest of the chain intact", async () => {
  act(() => useCanvasStore.getState().updateNodeData("author", { providerIds: ["an", "ol", "oa"] }));
  render(<PropertiesPanel />);

  await userEvent.setup().click(screen.getByRole("button", { name: /remove ollama local fallback/i }));
  expect(providerIds()).toEqual([["an", "oa"]]);
});

it("falls back to the raw id as a label when a chained connection was since removed under Providers", () => {
  act(() => useCanvasStore.getState().updateNodeData("author", { providerIds: ["an", "gone-id"] }));
  render(<PropertiesPanel />);
  expect(screen.getByText("gone-id")).toBeTruthy();
});

it("clearing the primary pin drops the whole fallback chain, not just the primary", async () => {
  act(() => useCanvasStore.getState().updateNodeData("author", { providerIds: ["an", "ol"] }));
  const user = userEvent.setup();
  render(<PropertiesPanel />);

  await user.selectOptions(screen.getByRole("combobox", { name: "Connection pin" }), "");
  expect(providerIds()).toEqual([[]]);
  expect(screen.queryByRole("combobox", { name: /add fallback connection/i })).toBeNull();
});
