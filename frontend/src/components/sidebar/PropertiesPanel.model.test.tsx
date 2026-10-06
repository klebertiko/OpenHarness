import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it } from "vitest";
import { useCanvasStore } from "@/store/canvasStore";
import { useProviderStore, type Connection } from "@/components/providers/providerStore";
import { PropertiesPanel } from "./PropertiesPanel";

/* providers-recovery F8: an agent's model is chosen from its pinned
   connection's list (the same picker the Providers screen uses), shows what
   "not pinned" actually means, and the pin list speaks the shared readiness
   words instead of a blanket "Unavailable". */

const ollama = {
  id: "ollama-local", provider: "ollama", label: "Ollama local", residence: "local", enabled: true, health: "live",
  secret: null, endpoint: "http://127.0.0.1:11434/v1", detail: "", probes: [], facts: [], lastProbe: "",
  models: [{ id: "gemma4:26b", ctx: 0 }, { id: "qwen3:8b", ctx: 0 }], modelsFromEndpoint: true, defaultModel: "gemma4:26b",
} as Connection;
const openrouter = {
  ...ollama, id: "openrouter", provider: "openrouter", label: "OpenRouter", residence: "cloud", defaultModel: "",
  models: [], modelsFromEndpoint: false,
} as Connection;

const initialCanvas = useCanvasStore.getState();
const initialProviders = useProviderStore.getState();
beforeEach(() => {
  useCanvasStore.setState({
    nodes: [{ id: "a", type: "agent", position: { x: 0, y: 0 }, data: { label: "Author", roleId: "BE", providerIds: ["ollama-local"] } }],
    edges: [],
    selectedNodeId: "a",
  });
  useProviderStore.setState({ connections: [ollama, openrouter] });
});
afterEach(() => {
  cleanup();
  useCanvasStore.setState(initialCanvas);
  useProviderStore.setState(initialProviders);
});

const model = () => useCanvasStore.getState().nodes[0].data.model;

it("lists the pinned connection's models and pins one on the node", async () => {
  const user = userEvent.setup();
  render(<PropertiesPanel />);
  await user.click(screen.getByRole("button", { name: /^Model: Connection default/ }));
  await user.click(screen.getByRole("option", { name: /qwen3:8b/ }));
  expect(model()).toBe("qwen3:8b");
});

it("names what the connection default is, and choosing it un-pins the model", async () => {
  const user = userEvent.setup();
  useCanvasStore.getState().updateNodeData("a", { model: "qwen3:8b" });
  render(<PropertiesPanel />);
  await user.click(screen.getByRole("button", { name: "Model: qwen3:8b" }));
  const inherit = screen.getByRole("option", { name: /connection default.*gemma4:26b/i });
  await user.click(inherit);
  expect(model()).toBe("");
});

it("labels a pin candidate with its real readiness, not a blanket Unavailable", async () => {
  const user = userEvent.setup();
  render(<PropertiesPanel />);
  await user.click(screen.getByRole("button", { name: /^Connection pin:/ }));
  expect(screen.getByRole("option", { name: /OpenRouter.*No model chosen/ })).toBeTruthy();
  expect(screen.queryByRole("option", { name: /Unavailable/ })).toBeNull();
});
