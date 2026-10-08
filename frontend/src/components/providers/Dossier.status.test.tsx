import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { Dossier } from "./Dossier";
import { ProvidersList } from "./ProvidersList";
import { useProviderStore, type Connection } from "./providerStore";

/** The dossier's credential seal and the sidebar list must tell the same
    story about one connection. */
function connection(overrides: Partial<Connection>): Connection {
  return {
    id: "an", provider: "anthropic", label: "Anthropic", residence: "cloud",
    endpoint: "", secret: null, health: "live", detail: "", probes: [], facts: [],
    models: [], defaultModel: "", enabled: true, lastProbe: "",
    ...overrides,
  };
}

const initial = useProviderStore.getState();
afterEach(() => {
  cleanup();
  useProviderStore.setState(initial, true);
});

function show(c: Connection) {
  useProviderStore.setState({ connections: [c], selectedId: c.id });
  render(
    <>
      <ProvidersList />
      <Dossier />
    </>,
  );
}

it("a CLI connection that tested live but is turned off is not 'connected via CLI' (the list files it under Needs setup)", () => {
  show(connection({ enabled: false, health: "live" }));
  expect(screen.queryByText(/connected via CLI/)).toBeNull();
  expect(screen.getByText("Needs setup")).toBeTruthy();
});

it("a CLI connection that is turned on but not yet tested is not 'CLI not connected' (the list files it under Ready)", () => {
  show(connection({ enabled: true, health: "setup" }));
  expect(screen.queryByText(/CLI not connected/)).toBeNull();
  expect(screen.getByText("Ready")).toBeTruthy();
});

it("a CLI connection that is turned on and verified reads connected in both places", () => {
  show(connection({ enabled: true, health: "live" }));
  expect(screen.getByText(/connected via CLI/)).toBeTruthy();
  expect(screen.getByText("Ready")).toBeTruthy();
});
