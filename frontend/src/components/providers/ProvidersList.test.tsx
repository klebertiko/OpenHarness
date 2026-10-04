import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { ProvidersList } from "./ProvidersList";
import { useProviderStore, type Connection } from "./providerStore";

/**
 * Grouping moved from residence (On this machine / Cloud) to readiness
 * (Ready / Needs setup) — the same split the chat combo uses
 * (`ChatProviderPicker.tsx`) — so a connection reads the same way on both
 * surfaces. Residence survives per row as the small mark next to the
 * status, not as the thing the list is organised by.
 */

function connection(overrides: Partial<Connection>): Connection {
  return {
    id: "a", provider: "anthropic", label: "A", residence: "cloud", endpoint: "",
    secret: null, health: "live", detail: "", probes: [], facts: [], models: [],
    route: [], routeSort: "price", allowed: [], enabled: true, lastProbe: "",
    ...overrides,
  };
}

const initial = useProviderStore.getState();
afterEach(() => {
  cleanup();
  useProviderStore.setState(initial, true);
});

it("groups connections by readiness, not residence, and names the same status word the chat combo uses", () => {
  useProviderStore.setState({
    connections: [
      connection({ id: "a", label: "Anthropic", residence: "cloud", enabled: true, health: "setup" }),
      connection({ id: "b", label: "Ollama local", residence: "local", enabled: false, health: "setup" }),
    ],
    selectedId: "a",
  });

  render(<ProvidersList />);

  const ready = screen.getByText("Ready").closest("section")!;
  const needsSetup = screen.getByText("Needs setup").closest("section")!;
  expect(within(ready).getByText("Anthropic")).toBeTruthy();
  expect(within(needsSetup).getByText("Ollama local")).toBeTruthy();
  // Same status words as ChatProviderPicker's rowStatus(), not the old
  // residence-grouped list's own "Connected"/"Needs setup" vocabulary.
  expect(within(ready).getByText("Not verified")).toBeTruthy();
  expect(within(needsSetup).getByText("Not connected")).toBeTruthy();
});

it("shows only the group that has rows — an all-ready install has no empty 'Needs setup' section", () => {
  useProviderStore.setState({
    connections: [connection({ id: "a", enabled: true, health: "live" })],
    selectedId: "a",
  });
  render(<ProvidersList />);
  expect(screen.getByText("Ready")).toBeTruthy();
  expect(screen.queryByText("Needs setup")).toBeNull();
});
