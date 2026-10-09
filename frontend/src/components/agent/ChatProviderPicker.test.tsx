import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useProviderStore, type Connection } from "@/components/providers/providerStore";
import { useChatProviderStore } from "@/store/chatProviderStore";
import { useChatSetupRequestStore } from "@/store/chatSetupStore";
import { ChatProviderPicker } from "./ChatProviderPicker";

function connection(overrides: Partial<Connection>): Connection {
  return {
    id: "an", provider: "anthropic", label: "Anthropic", residence: "cloud",
    endpoint: "", secret: null, health: "live", detail: "", probes: [], facts: [],
    models: [], defaultModel: "", enabled: true,
    lastProbe: "", ...overrides,
  };
}

const initialProvider = useProviderStore.getState();
const initialChat = useChatProviderStore.getState();
const initialSetupRequest = useChatSetupRequestStore.getState();

beforeEach(() => {
  useProviderStore.setState({
    connections: [
      connection({}),
      connection({ id: "oa", provider: "openai", label: "OpenAI", enabled: false, health: "setup" }),
      connection({ id: "ol", provider: "ollama", label: "Ollama local", residence: "local", health: "live", defaultModel: "llama3" }),
      connection({ id: "cu", provider: "cursor", label: "Cursor", enabled: false, health: "setup" }),
    ],
    selectedId: "an",
  });
  useChatProviderStore.setState({ chosenId: "an" });
  useChatSetupRequestStore.setState({ token: 0, id: null });
});
afterEach(() => {
  cleanup();
  useProviderStore.setState(initialProvider, true);
  useChatProviderStore.setState(initialChat);
  useChatSetupRequestStore.setState(initialSetupRequest);
});

const open = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole("button", { name: /^chat provider:/i }));
  return screen.getByRole("listbox", { name: "Chat provider" });
};

it("lists Auto and only the providers that can answer right now", async () => {
  const user = userEvent.setup();
  render(<ChatProviderPicker onConnect={vi.fn()} />);
  const list = await open(user);

  const names = within(list).getAllByRole("option").map((o) => o.textContent ?? "");
  expect(names).toHaveLength(3);
  expect(names[0]).toMatch(/^Auto/);
  expect(names[1]).toMatch(/^Anthropic/);
  expect(names[2]).toMatch(/^Ollama local/);
  // Nothing to configure inside the picker: no setup rows, no key field.
  expect(screen.queryByText("Set up")).toBeNull();
  expect(screen.queryByText("Needs setup")).toBeNull();
  expect(screen.queryByText(/OpenAI/)).toBeNull();
  expect(document.querySelector("input[type=password]")).toBeNull();
});

it("choosing a ready provider sets the chat default and closes", async () => {
  const user = userEvent.setup();
  render(<ChatProviderPicker onConnect={vi.fn()} />);
  const list = await open(user);
  await user.click(within(list).getByRole("option", { name: /^ollama local/i }));
  expect(useChatProviderStore.getState().chosenId).toBe("ol");
  expect(screen.queryByRole("listbox")).toBeNull();
  expect(screen.getByRole("button", { name: /chat provider: ollama local.*verified/i })).toBeTruthy();
});

it("keeps a previously chosen provider that is no longer ready visible as the selection", async () => {
  const user = userEvent.setup();
  useChatProviderStore.setState({ chosenId: "oa" });
  render(<ChatProviderPicker onConnect={vi.fn()} />);
  const list = await open(user);
  const row = within(list).getByRole("option", { name: /^openai.*not connected/i });
  expect(row.getAttribute("aria-selected")).toBe("true");
});

it("shows a stale choice as unavailable when its connection is gone", async () => {
  const user = userEvent.setup();
  useChatProviderStore.setState({ chosenId: "gone" });
  render(<ChatProviderPicker onConnect={vi.fn()} />);
  const list = await open(user);
  expect(within(list).getByRole("option", { name: /unavailable provider.*no longer available/i }).getAttribute("aria-selected")).toBe("true");
});

it("sends setup to the Providers screen, naming how many connections need it", async () => {
  const user = userEvent.setup();
  const onConnect = vi.fn();
  render(<ChatProviderPicker onConnect={onConnect} />);
  await open(user);
  // OpenAI is off; Cursor is delegation-only and not a chat setup item.
  await user.click(screen.getByRole("button", { name: /manage providers.*1 needs setup/i }));
  expect(onConnect).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole("listbox")).toBeNull();
});

it("a setup request from the composer opens Providers on that connection instead of expanding a form", async () => {
  const onConnect = vi.fn();
  render(<ChatProviderPicker onConnect={onConnect} />);
  act(() => useChatSetupRequestStore.getState().requestSetup("oa"));
  expect(useProviderStore.getState().selectedId).toBe("oa");
  expect(onConnect).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole("listbox")).toBeNull();
});

it("a setup request with no target opens the picker so the person can choose", async () => {
  render(<ChatProviderPicker onConnect={vi.fn()} />);
  act(() => useChatSetupRequestStore.getState().requestSetup(null));
  expect(screen.getByRole("listbox", { name: "Chat provider" })).toBeTruthy();
});

it("with nothing ready, says so and offers the Providers screen", async () => {
  const user = userEvent.setup();
  const onConnect = vi.fn();
  useChatProviderStore.setState({ chosenId: null });
  useProviderStore.setState({ connections: [connection({ id: "oa", provider: "openai", label: "OpenAI", enabled: false, health: "setup" })] });
  render(<ChatProviderPicker onConnect={onConnect} />);
  expect(screen.getByRole("button", { name: /chat provider: auto · no available provider/i })).toBeTruthy();
  await open(user);
  expect(screen.getByText(/no provider is ready/i)).toBeTruthy();
  await user.click(screen.getByRole("button", { name: /manage providers/i }));
  expect(onConnect).toHaveBeenCalledTimes(1);
});

it("the chip dot reads the connection's real state", () => {
  for (const [health, enabled, status] of [
    ["live", true, "Verified"],
    ["degraded", true, "Needs attention"],
    ["probing", true, "Checking connection"],
    ["fault", true, "Unavailable"],
    ["live", false, "Not connected"],
  ] as const) {
    useProviderStore.setState({ connections: [connection({ health, enabled })] });
    const { unmount } = render(<ChatProviderPicker onConnect={vi.fn()} />);
    const chip = screen.getByRole("button", { name: new RegExp("chat provider: anthropic.*" + status, "i") });
    expect(Boolean(chip.querySelector(".bg-signal"))).toBe(health === "live" && enabled);
    unmount();
  }
});
