import { beforeEach, describe, expect, it } from "vitest";
import { useShellStore } from "./shellStore";

describe("shellStore.overlay", () => {
  beforeEach(() => {
    useShellStore.setState({
      overlay: null,
      paletteOpen: false,
      keymapOpen: false,
    });
  });

  it("defaults overlay to null", () => {
    expect(useShellStore.getState().overlay).toBeNull();
  });

  it("setOverlay opens a panel id and closes palette/keymap", () => {
    useShellStore.setState({ paletteOpen: true, keymapOpen: true });
    useShellStore.getState().setOverlay("cowork");
    expect(useShellStore.getState().overlay).toBe("cowork");
    expect(useShellStore.getState().paletteOpen).toBe(false);
    expect(useShellStore.getState().keymapOpen).toBe(false);
  });

  it("setOverlay accepts automations and git", () => {
    useShellStore.getState().setOverlay("automations");
    expect(useShellStore.getState().overlay).toBe("automations");
    useShellStore.getState().setOverlay("git");
    expect(useShellStore.getState().overlay).toBe("git");
  });

  it("dismissOverlays clears overlay with palette and keymap", () => {
    useShellStore.setState({
      overlay: "git",
      paletteOpen: true,
      keymapOpen: true,
    });
    useShellStore.getState().dismissOverlays();
    expect(useShellStore.getState().overlay).toBeNull();
    expect(useShellStore.getState().paletteOpen).toBe(false);
    expect(useShellStore.getState().keymapOpen).toBe(false);
  });
});
