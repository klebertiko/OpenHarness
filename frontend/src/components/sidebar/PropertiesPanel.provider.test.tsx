
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it } from "vitest";
import { useCanvasStore } from "@/store/canvasStore";
import { useChatProviderStore } from "@/store/chatProviderStore";
import { useProviderStore, type Connection } from "@/components/providers/providerStore";
import { PropertiesPanel } from "./PropertiesPanel";

const initialCanvas = useCanvasStore.getState();
const initialProviders = useProviderStore.getState();
const initialChat = useChatProviderStore.getState();
beforeEach(() => {
  useCanvasStore.setState({
    nodes: [
      { id: "author", type: "agent", position: { x: 0, y: 0 }, data: { label: "Author", roleId: "BE" } },
      { id: "reviewer", type: "agent", position: { x: 250, y: 0 }, data: { label: "Reviewer", roleId: "QA" } },
    ],
    edges: [],
    selectedNodeId: "author",
  });
  useProviderStore.setState({
    connections: [
      { id: "an", label: "Anthropic", enabled: true, health: "setup", secret: null },
      { id: "ol", label: "Ollama local", enabled: true, health: "live", secret: null },
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

it("keeps two agents pinned independently when the chat default changes or another pin is cleared", async () => {
  const user = userEvent.setup();
  render(<PropertiesPanel />);
  await user.selectOptions(screen.getByRole("combobox", { name: "Connection pin" }), "an");
  act(() => useCanvasStore.getState().setSelectedNode("reviewer"));
  await user.selectOptions(screen.getByRole("combobox", { name: "Connection pin" }), "ol");
  act(() => useChatProviderStore.getState().setChosen(null));

  act(() => useCanvasStore.getState().setSelectedNode("author"));
  expect((screen.getByRole("combobox", { name: "Connection pin" }) as HTMLSelectElement).value).toBe("an");
  expect(screen.getByText(/in chat, a pinned connection overrides the chat provider/i)).toBeTruthy();
  act(() => useCanvasStore.getState().setSelectedNode("reviewer"));
  expect((screen.getByRole("combobox", { name: "Connection pin" }) as HTMLSelectElement).value).toBe("ol");
  expect(useCanvasStore.getState().nodes.map((n) => n.data.providerIds)).toEqual([["an"], ["ol"]]);

  await user.selectOptions(screen.getByRole("combobox", { name: "Connection pin" }), "");
  expect(useCanvasStore.getState().nodes.map((n) => n.data.providerIds)).toEqual([["an"], []]);
  act(() => useCanvasStore.getState().setSelectedNode("author"));
  expect((screen.getByRole("combobox", { name: "Connection pin" }) as HTMLSelectElement).value).toBe("an");
});
