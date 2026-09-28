
import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useProviderStore, type Connection } from "@/components/providers/providerStore";
import { useChatProviderStore } from "@/store/chatProviderStore";
import { ChatProviderPicker } from "./ChatProviderPicker";

function connection(overrides: Partial<Connection>): Connection {
  return {
    id: "an", provider: "anthropic", label: "Anthropic", residence: "cloud",
    endpoint: "", secret: null, health: "setup", detail: "", probes: [], facts: [],
    models: [], route: [], routeSort: "price", allowed: [], enabled: true,
    lastProbe: "", ...overrides,
  };
}
const initialProvider = useProviderStore.getState();
const initialChat = useChatProviderStore.getState();
beforeEach(() => {
  useProviderStore.setState({
    connections: [
      connection({}),
      connection({ id: "oa", provider: "openai", label: "OpenAI", enabled: false }),
      connection({ id: "ol", provider: "ollama", label: "Ollama local", residence: "local", health: "live" }),
    ],
    selectedId: "an",
  });
  useChatProviderStore.setState({ chosenId: "an" });
});
afterEach(() => {
  cleanup();
  useProviderStore.setState(initialProvider);
  useChatProviderStore.setState(initialChat);
});

it("chooses without claiming verification and configures an unavailable entry by keyboard without changing the chat choice", async () => {
  const user = userEvent.setup();
  const onConnect = vi.fn();
  const before = useProviderStore.getState().connections;
  render(<ChatProviderPicker onConnect={onConnect} />);

  const trigger = screen.getByRole("button", { name: /chat provider: anthropic.*not verified/i });
  expect(trigger.querySelector(".bg-signal")).toBeNull();
  await user.click(trigger);
  const list = screen.getByRole("listbox", { name: "Chat provider" });
  expect(document.activeElement).toBe(list);
  expect(within(list).getByRole("option", { name: /^anthropic.*not verified/i }).getAttribute("aria-selected")).toBe("true");

  await user.keyboard("{ArrowDown}{Enter}");
  expect(useChatProviderStore.getState().chosenId).toBe("an");
  expect(onConnect).not.toHaveBeenCalled();
  // OpenAI here is disabled with health "setup" (never probed) — the
  // genuinely-never-configured state, which now reads "Not connected"
  // rather than "Unavailable" (that word is reserved for a real failed
  // probe — see the row-tone tests below).
  expect(within(list).getByRole("option", { name: /openai.*not connected/i }).getAttribute("aria-disabled")).toBe("true");
  await user.tab();
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "Configure OpenAI" }));
  await user.keyboard("{Enter}");
  expect(onConnect).toHaveBeenCalledOnce();
  expect(useProviderStore.getState().selectedId).toBe("oa");
  expect(useChatProviderStore.getState().chosenId).toBe("an");
  expect(useProviderStore.getState().connections).toEqual(before);
  expect(document.activeElement).toBe(trigger);

  await user.keyboard("{ArrowDown}{End}{Enter}");
  expect(useChatProviderStore.getState().chosenId).toBe("ol");
  expect(screen.getByRole("button", { name: /chat provider: ollama local.*verified/i })).toBeTruthy();
  expect(useProviderStore.getState().connections).toEqual(before);
  await user.click(trigger);
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("listbox")).toBeNull();
  expect(document.activeElement).toBe(trigger);

  act(() => useChatProviderStore.getState().setChosen(null));
  expect(screen.getByRole("button", { name: /chat provider: auto.*anthropic.*not verified/i })).toBeTruthy();
  await user.click(trigger);
  expect(screen.getByRole("option", { name: /auto.*uses anthropic.*not verified/i })).toBeTruthy();
  await user.keyboard("{Escape}");

  for (const [health, enabled, status] of [
    ["live", true, "Verified"],
    ["degraded", true, "Needs attention"],
    ["probing", true, "Checking connection"],
    ["fault", true, "Unavailable"],
    ["live", false, "Unavailable"],
  ] as const) {
    act(() => {
      useChatProviderStore.getState().setChosen("an");
      useProviderStore.setState({ connections: [connection({ health, enabled })] });
    });
    const chip = screen.getByRole("button", { name: new RegExp("chat provider: anthropic.*" + status, "i") });
    expect(Boolean(chip.querySelector(".bg-signal"))).toBe(health === "live" && enabled);
  }

  act(() => useProviderStore.setState({ connections: [] }));
  await user.click(screen.getByRole("button", { name: /chat provider: unavailable provider/i }));
  expect(screen.getByRole("option", { name: /unavailable provider.*no longer available/i }).getAttribute("aria-selected")).toBe("true");
  expect(screen.getByRole("option", { name: /auto.*no available provider/i })).toBeTruthy();
});


it("keeps the focused option valid if the connection list changes while open", async () => {
  const user = userEvent.setup();
  render(<ChatProviderPicker onConnect={vi.fn()} />);
  await user.click(screen.getByRole("button", { name: /chat provider:/i }));
  await user.keyboard("{End}");
  act(() => useProviderStore.setState({ connections: [] }));
  const list = screen.getByRole("listbox", { name: "Chat provider" });
  expect(document.getElementById(list.getAttribute("aria-activedescendant")!)).not.toBeNull();
  await user.keyboard("{Home}{Enter}");
  expect(useChatProviderStore.getState().chosenId).toBeNull();
  expect(screen.getByRole("button", { name: /auto.*no available provider/i })).toBeTruthy();
});


it("configures Auto's resolved provider without replacing an explicit chat choice", async () => {
  const user = userEvent.setup();
  const onConnect = vi.fn();
  useChatProviderStore.setState({ chosenId: "ol" });
  useProviderStore.setState({ selectedId: "ol" });
  const before = useProviderStore.getState().connections;
  render(<ChatProviderPicker onConnect={onConnect} />);
  const trigger = screen.getByRole("button", { name: /chat provider: ollama local.*verified/i });
  await user.click(trigger);
  await user.keyboard("{Home}");
  expect(screen.getByRole("option", { name: /^auto.*uses anthropic.*not verified/i })).toBeTruthy();
  await user.tab();
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "Configure Anthropic" }));
  await user.keyboard("{Enter}");
  expect(onConnect).toHaveBeenCalledOnce();
  expect(useProviderStore.getState().selectedId).toBe("an");
  expect(useChatProviderStore.getState().chosenId).toBe("ol");
  expect(useProviderStore.getState().connections).toEqual(before);
  expect(document.activeElement).toBe(trigger);
});


it("gives a probing connection a pulsing dot, distinct from the static not-verified dot", () => {
  render(<ChatProviderPicker onConnect={vi.fn()} />);

  const notVerified = screen.getByRole("button", { name: /chat provider: anthropic.*not verified/i });
  expect(notVerified.querySelector(".animate-pulse")).toBeNull();

  act(() => useProviderStore.setState({ connections: [connection({ health: "probing" })] }));
  const checking = screen.getByRole("button", { name: /chat provider: anthropic.*checking connection/i });
  expect(checking.querySelector(".animate-pulse")).not.toBeNull();
  expect(checking.querySelector(".bg-signal")).toBeNull();
  expect(checking.querySelector(".bg-warn")).toBeNull();
  expect(checking.querySelector(".bg-ink-faint")).not.toBeNull();
});


it("surfaces a real lastProbe time in the chip's tooltip, and invents nothing when unprobed", () => {
  render(<ChatProviderPicker onConnect={vi.fn()} />);

  const unprobed = screen.getByRole("button", { name: /chat provider: anthropic.*not verified/i });
  expect(unprobed.title).not.toMatch(/checked/i);

  const twoMinAgo = new Date(Date.now() - 2 * 60_000).toISOString();
  act(() => useProviderStore.setState({ connections: [connection({ health: "live", lastProbe: twoMinAgo })] }));
  const verified = screen.getByRole("button", { name: /chat provider: anthropic.*verified.*checked 2m/i });
  expect(verified.title).toBe("Anthropic · Verified · checked 2m");
});


it("gives each dropdown row a status dot distinct per health/enabled state", async () => {
  const user = userEvent.setup();
  render(<ChatProviderPicker onConnect={vi.fn()} />);

  const cases = [
    // [health, enabled, class that must be on the row's dot, classes that must not be]
    ["live", true, "bg-signal", ["bg-warn", "bg-fault", "border-ink-faint"]],
    ["degraded", true, "bg-warn", ["bg-signal", "bg-fault", "border-ink-faint"]],
    ["probing", true, "bg-ink-faint", ["bg-signal", "bg-warn", "bg-fault", "border-ink-faint"]],
    ["fault", true, "bg-fault", ["bg-signal", "bg-warn", "border-ink-faint"]],
    // Configured and enabled, but never probed — neutral and static.
    ["setup", true, "bg-ink-faint", ["bg-signal", "bg-warn", "bg-fault", "border-ink-faint", "animate-pulse"]],
    // Genuinely never configured (no credential / turned off) — same neutral
    // family as "never probed" but hollow, never the filled failing red.
    ["setup", false, "border-ink-faint", ["bg-signal", "bg-warn", "bg-fault", "bg-ink-faint"]],
  ] as const;

  for (const [health, enabled, present, absent] of cases) {
    act(() => {
      useChatProviderStore.getState().setChosen("an");
      useProviderStore.setState({ connections: [connection({ health, enabled, lastProbe: "" })] });
    });
    await user.click(screen.getByRole("button", { name: /chat provider:/i }));
    const row = within(screen.getByRole("listbox")).getByRole("option", { name: /^anthropic/i });
    expect(row.querySelector("." + present)).not.toBeNull();
    for (const cls of absent) {
      expect(row.querySelector("." + cls)).toBeNull();
    }
    await user.keyboard("{Escape}");
  }
});


it("shows a failed credential and a never-configured one with different dots side by side", async () => {
  const user = userEvent.setup();
  useProviderStore.setState({
    connections: [
      connection({ id: "an", health: "fault", enabled: true }),
      connection({ id: "oa", provider: "openai", label: "OpenAI", health: "setup", enabled: false, lastProbe: "" }),
    ],
  });
  render(<ChatProviderPicker onConnect={vi.fn()} />);
  await user.click(screen.getByRole("button", { name: /chat provider:/i }));
  const list = screen.getByRole("listbox");

  const failing = within(list).getByRole("option", { name: /^anthropic.*unavailable/i });
  const unconfigured = within(list).getByRole("option", { name: /openai.*not connected/i });
  expect(failing.querySelector(".bg-fault")).not.toBeNull();
  expect(failing.querySelector(".border-ink-faint")).toBeNull();
  expect(unconfigured.querySelector(".bg-fault")).toBeNull();
  expect(unconfigured.querySelector(".border-ink-faint")).not.toBeNull();
});
