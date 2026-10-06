
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
    endpoint: "", secret: null, health: "setup", detail: "", probes: [], facts: [],
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
      connection({ id: "oa", provider: "openai", label: "OpenAI", enabled: false }),
      connection({ id: "ol", provider: "ollama", label: "Ollama local", residence: "local", health: "live", defaultModel: "llama3" }),
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

  // OpenAI here is disabled with health "setup" (never probed) — the
  // genuinely-never-configured state, which reads "Not connected" rather
  // than "Unavailable" (that word is reserved for a real failed probe —
  // see the row-tone tests below). Any row is choosable now: there is no
  // aria-disabled gate left on an option.
  const openaiRow = within(list).getByRole("option", { name: /openai.*not connected/i });
  expect(openaiRow.getAttribute("aria-disabled")).toBeNull();

  // Grouped order puts every ready row (Auto, Anthropic, Ollama local)
  // before the one row that needs setup (OpenAI) — End now lands on OpenAI,
  // and Enter there opens its fix-it form instead of closing the combo.
  await user.keyboard("{End}{Enter}");
  expect(useChatProviderStore.getState().chosenId).toBe("oa");
  expect(screen.getByRole("listbox")).toBeTruthy();
  expect(useProviderStore.getState().connections).toEqual(before);
  await user.keyboard("{Escape}{Escape}");
  expect(document.activeElement).toBe(trigger);

  // Ollama local (ready) is reachable by Home from the ready group's start.
  await user.click(trigger);
  await user.keyboard("{Home}{ArrowDown}{ArrowDown}{Enter}");
  expect(useChatProviderStore.getState().chosenId).toBe("ol");
  expect(screen.getByRole("button", { name: /chat provider: ollama local.*verified/i })).toBeTruthy();
  expect(useProviderStore.getState().connections).toEqual(before);
  expect(screen.queryByRole("listbox")).toBeNull();
  expect(document.activeElement).toBe(trigger);

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
    ["live", false, "Not connected"],
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


it("selecting the stale 'Unavailable provider' placeholder just re-selects it — there is nothing behind it to set up", async () => {
  const user = userEvent.setup();
  act(() => useProviderStore.setState({ connections: [] }));
  render(<ChatProviderPicker onConnect={vi.fn()} />);
  await user.click(screen.getByRole("button", { name: /chat provider: unavailable provider/i }));
  await user.click(screen.getByRole("option", { name: /unavailable provider.*no longer available/i }));
  expect(useChatProviderStore.getState().chosenId).toBe("an");
  expect(screen.queryByRole("listbox")).toBeNull();
});


it("clicking a not-connected row sets it as the chat default AND opens its fix-it form inline — the combo never sends you to another screen just to choose", async () => {
  const user = userEvent.setup();
  const onConnect = vi.fn();
  render(<ChatProviderPicker onConnect={onConnect} />);
  await user.click(screen.getByRole("button", { name: /chat provider:/i }));
  await user.click(screen.getByRole("option", { name: /openai.*not connected/i }));

  // design.md § Provider stance: any row is choosable, ready or not.
  expect(onConnect).not.toHaveBeenCalled();
  expect(useChatProviderStore.getState().chosenId).toBe("oa");
  // The combo stays open — the fix lives right here, not on another screen.
  expect(screen.getByRole("listbox")).toBeTruthy();
  // OpenAI has no stored key (catalog: credential.kind "cli") — a single switch, no password field.
  expect(screen.getByRole("button", { name: "Turn on OpenAI" })).toBeTruthy();
  expect(screen.queryByLabelText(/paste .* key/i)).toBeNull();

  // Clicking the same row again collapses the form without un-choosing it.
  await user.click(screen.getByRole("option", { name: /openai.*not connected/i }));
  expect(screen.queryByRole("button", { name: "Turn on OpenAI" })).toBeNull();
  expect(useChatProviderStore.getState().chosenId).toBe("oa");
});


it("keyless inline setup turns the connection on, then tests it, in that order", async () => {
  const user = userEvent.setup();
  const calls: string[] = [];
  useProviderStore.setState({
    toggleEnabled: async (id) => {
      calls.push("toggleEnabled:" + id);
    },
    probe: async (id) => {
      calls.push("probe:" + id);
    },
  });
  render(<ChatProviderPicker onConnect={vi.fn()} />);
  await user.click(screen.getByRole("button", { name: /chat provider:/i }));
  await user.click(screen.getByRole("option", { name: /openai.*not connected/i }));
  await user.click(screen.getByRole("button", { name: "Turn on OpenAI" }));

  expect(calls).toEqual(["toggleEnabled:oa", "probe:oa"]);
});


it("already-enabled-but-failing keyless connection offers a retest, not a redundant switch", async () => {
  const user = userEvent.setup();
  const calls: string[] = [];
  useProviderStore.setState({
    connections: [connection({ id: "oa", provider: "openai", label: "OpenAI", enabled: true, health: "fault", detail: "cursor-agent is not logged in." })],
    toggleEnabled: async (id) => { calls.push("toggleEnabled:" + id); },
    probe: async (id) => { calls.push("probe:" + id); },
  });
  render(<ChatProviderPicker onConnect={vi.fn()} />);
  await user.click(screen.getByRole("button", { name: /chat provider:/i }));
  await user.click(screen.getByRole("option", { name: /openai.*unavailable/i }));
  await user.click(screen.getByRole("button", { name: "Test again" }));

  expect(calls).toEqual(["probe:oa"]);
  expect(screen.getByText("cursor-agent is not logged in.")).toBeTruthy();
});


it("keyed inline setup validates the vendor prefix and connects with attachSecret, then toggleEnabled only if still not enabled, then probe", async () => {
  const user = userEvent.setup();
  const calls: string[] = [];
  useProviderStore.setState({
    connections: [connection({ id: "or", provider: "openrouter", label: "OpenRouter", enabled: false, health: "setup" })],
    attachSecret: async (id) => {
      calls.push("attachSecret:" + id);
      // Does not flip `enabled` itself here — exercises the inline form's
      // own fallback toggle, distinct from the real store's behaviour.
    },
    toggleEnabled: async (id) => { calls.push("toggleEnabled:" + id); },
    probe: async (id) => { calls.push("probe:" + id); },
  });
  render(<ChatProviderPicker onConnect={vi.fn()} />);
  await user.click(screen.getByRole("button", { name: /chat provider:/i }));
  await user.click(screen.getByRole("option", { name: /openrouter.*not connected/i }));

  const input = screen.getByLabelText("Paste OpenRouter key");
  const connectBtn = screen.getByRole("button", { name: "Connect" }) as HTMLButtonElement;
  expect(connectBtn.disabled).toBe(true);

  await user.type(input, "nope-wrong-vendor");
  expect(screen.getByText(/OpenRouter keys begin sk-or-/)).toBeTruthy();
  expect(connectBtn.disabled).toBe(true);

  await user.clear(input);
  await user.type(input, "sk-or-realkey123");
  expect(connectBtn.disabled).toBe(false);
  await user.click(connectBtn);

  expect(calls).toEqual(["attachSecret:or", "toggleEnabled:or", "probe:or"]);
  // The pasted value is never left sitting in a controlled field.
  expect((input as HTMLInputElement).value).toBe("");
});


it("says plainly when saving the key fails, without echoing the error or the key", async () => {
  const user = userEvent.setup();
  useProviderStore.setState({
    connections: [connection({ id: "or", provider: "openrouter", label: "OpenRouter", enabled: false, health: "setup" })],
    attachSecret: async () => { throw new Error("boom sk-or-realkey123"); },
    toggleEnabled: async () => {},
    probe: async () => {},
  });
  render(<ChatProviderPicker onConnect={vi.fn()} />);
  await user.click(screen.getByRole("button", { name: /chat provider:/i }));
  await user.click(screen.getByRole("option", { name: /openrouter.*not connected/i }));
  const input = screen.getByLabelText("Paste OpenRouter key") as HTMLInputElement;
  await user.type(input, "sk-or-realkey123");
  await user.click(screen.getByRole("button", { name: "Connect" }));

  expect(screen.getByText("Couldn't save the key. Check the app is running and try again.")).toBeTruthy();
  expect(input.value).toBe("");
  expect(document.body.textContent).not.toContain("realkey123");
});


it("skips the fallback toggle when attachSecret already enabled the connection itself", async () => {
  const user = userEvent.setup();
  const calls: string[] = [];
  useProviderStore.setState({
    connections: [connection({ id: "or", provider: "openrouter", label: "OpenRouter", enabled: false, health: "setup" })],
    attachSecret: async (id) => {
      calls.push("attachSecret:" + id);
      useProviderStore.setState({
        connections: useProviderStore.getState().connections.map((c) => (c.id === id ? { ...c, enabled: true } : c)),
      });
    },
    toggleEnabled: async (id) => { calls.push("toggleEnabled:" + id); },
    probe: async (id) => { calls.push("probe:" + id); },
  });
  render(<ChatProviderPicker onConnect={vi.fn()} />);
  await user.click(screen.getByRole("button", { name: /chat provider:/i }));
  await user.click(screen.getByRole("option", { name: /openrouter.*not connected/i }));
  await user.type(screen.getByLabelText("Paste OpenRouter key"), "sk-or-realkey123");
  await user.click(screen.getByRole("button", { name: "Connect" }));

  expect(calls).toEqual(["attachSecret:or", "probe:or"]);
});


it("a quiet secondary link opens the full Providers screen on this exact connection, for advanced config", async () => {
  const user = userEvent.setup();
  const onConnect = vi.fn();
  render(<ChatProviderPicker onConnect={onConnect} />);
  await user.click(screen.getByRole("button", { name: /chat provider:/i }));
  await user.click(screen.getByRole("option", { name: /openai.*not connected/i }));
  await user.click(screen.getByRole("button", { name: "Open in Providers" }));

  expect(onConnect).toHaveBeenCalledOnce();
  expect(useProviderStore.getState().selectedId).toBe("oa");
  // Choosing it stays — opening Providers for advanced config is not the
  // same action as abandoning the pick.
  expect(useChatProviderStore.getState().chosenId).toBe("oa");
  expect(screen.queryByRole("listbox")).toBeNull();
});


it("the footer stays a generic escape hatch, not a per-row configure button", async () => {
  const user = userEvent.setup();
  const onConnect = vi.fn();
  render(<ChatProviderPicker onConnect={onConnect} />);
  await user.click(screen.getByRole("button", { name: /chat provider:/i }));
  await user.click(screen.getByRole("button", { name: "Manage providers" }));
  expect(onConnect).toHaveBeenCalledOnce();
  expect(useProviderStore.getState().selectedId).toBe("an");
});


it("groups Ready above Needs setup only when the list is genuinely mixed", async () => {
  const user = userEvent.setup();
  render(<ChatProviderPicker onConnect={vi.fn()} />);
  await user.click(screen.getByRole("button", { name: /chat provider:/i }));
  const list = screen.getByRole("listbox");
  expect(within(list).getByText("Ready")).toBeTruthy();
  expect(within(list).getByText("Needs setup")).toBeTruthy();
  await user.keyboard("{Escape}");

  // All ready: no labels to show.
  act(() => {
    useProviderStore.setState({ connections: [connection({ id: "a1" }), connection({ id: "a2" })] });
    useChatProviderStore.setState({ chosenId: "a1" });
  });
  await user.click(screen.getByRole("button", { name: /chat provider:/i }));
  expect(screen.queryByText("Needs setup")).toBeNull();
  expect(screen.queryByText("Ready")).toBeNull();
});


it("keyboard: Enter on a not-ready row focuses its fix-it control, and Escape backs out one layer at a time", async () => {
  const user = userEvent.setup();
  render(<ChatProviderPicker onConnect={vi.fn()} />);
  const trigger = screen.getByRole("button", { name: /chat provider:/i });
  await user.click(trigger);
  await user.keyboard("{End}{Enter}"); // OpenAI is last (Needs setup group)

  const turnOn = screen.getByRole("button", { name: "Turn on OpenAI" });
  expect(document.activeElement).toBe(turnOn);

  await user.keyboard("{Escape}");
  // First Escape collapses the inline form, keeping the combo open.
  expect(screen.getByRole("listbox")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Turn on OpenAI" })).toBeNull();

  await user.keyboard("{Escape}");
  // Second Escape closes the whole combo.
  expect(screen.queryByRole("listbox")).toBeNull();
  expect(document.activeElement).toBe(trigger);
});


it("an external request opens the combo already expanded on the named connection", () => {
  render(<ChatProviderPicker onConnect={vi.fn()} />);
  expect(screen.queryByRole("listbox")).toBeNull();

  act(() => useChatSetupRequestStore.getState().requestSetup("oa"));
  expect(screen.getByRole("listbox")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Turn on OpenAI" })).toBeTruthy();
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


it("configures Auto's resolved provider without replacing an explicit chat choice, via the generic footer", async () => {
  const user = userEvent.setup();
  const onConnect = vi.fn();
  useChatProviderStore.setState({ chosenId: "ol" });
  useProviderStore.setState({ selectedId: "ol" });
  const before = useProviderStore.getState().connections;
  render(<ChatProviderPicker onConnect={onConnect} />);
  const trigger = screen.getByRole("button", { name: /chat provider: ollama local.*verified/i });
  await user.click(trigger);
  await user.click(screen.getByRole("button", { name: "Manage providers" }));
  expect(onConnect).toHaveBeenCalledOnce();
  expect(useProviderStore.getState().selectedId).toBe("ol");
  expect(useChatProviderStore.getState().chosenId).toBe("ol");
  expect(useProviderStore.getState().connections).toEqual(before);
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


it("a connected HTTP provider with no model asks for one in place and saves it as the connection default (F5/F7)", async () => {
  const user = userEvent.setup();
  const setDefaultModel = vi.fn().mockResolvedValue(true);
  useProviderStore.setState({
    connections: [
      connection({
        id: "ol", provider: "ollama", label: "Ollama local", residence: "local", health: "live",
        models: [{ id: "gemma4:26b", ctx: 0 }], modelsFromEndpoint: true,
      }),
    ],
    setDefaultModel: setDefaultModel as never,
  });
  useChatProviderStore.setState({ chosenId: "ol" });
  render(<ChatProviderPicker onConnect={vi.fn()} />);

  const trigger = screen.getByRole("button", { name: /chat provider: ollama local.*no model chosen/i });
  await user.click(trigger);
  await user.click(screen.getByRole("option", { name: /ollama local/i }));
  expect(screen.getByText("Choose a model for Ollama local")).toBeTruthy();

  const modelTrigger = screen.getByRole("button", { name: /ollama local model: none chosen/i });
  expect(document.activeElement).toBe(modelTrigger);
  await user.click(modelTrigger);
  // The nested model list opens without collapsing the provider combo.
  expect(screen.getByRole("listbox", { name: "Chat provider" })).toBeTruthy();
  await user.click(screen.getByRole("option", { name: /gemma4:26b/ }));
  expect(setDefaultModel).toHaveBeenCalledWith("ol", "gemma4:26b");
  expect(screen.getByRole("listbox", { name: "Chat provider" })).toBeTruthy();
});

it("derives the chip dot from providerReadiness' tone, matching the dropdown rows", () => {
  render(<ChatProviderPicker onConnect={vi.fn()} />);

  // A failing connection wears the same red dot on the chip as in its row,
  // not the amber one the old status-text matching gave every non-ready word.
  act(() => {
    useChatProviderStore.getState().setChosen("an");
    useProviderStore.setState({ connections: [connection({ health: "fault", enabled: true })] });
  });
  const failing = screen.getByRole("button", { name: /chat provider: anthropic.*unavailable/i });
  expect(failing.querySelector(".bg-fault")).not.toBeNull();
  expect(failing.querySelector(".bg-warn")).toBeNull();

  // A turned-off connection wears the hollow "unconfigured" ring.
  act(() => useProviderStore.setState({ connections: [connection({ health: "setup", enabled: false })] }));
  const off = screen.getByRole("button", { name: /chat provider: anthropic.*not connected/i });
  expect(off.querySelector(".border-ink-faint")).not.toBeNull();
  expect(off.querySelector(".bg-ink-faint")).toBeNull();

  act(() => useProviderStore.setState({ connections: [] }));
});
