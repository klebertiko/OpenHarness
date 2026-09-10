import { beforeEach, describe, expect, it } from "vitest";
import { shellModeAndHarnessCommands, shellOverlayCommands } from "./commands";
import { useModeStore } from "@/store/modeStore";
import { useHarnessSessionStore } from "@/store/harnessSessionStore";
import { useShellStore } from "./shellStore";

describe("shellModeAndHarnessCommands", () => {
  beforeEach(() => {
    useModeStore.setState({ mode: "agent" });
    useHarnessSessionStore.setState({
      enabled: true,
      activeBundle: null,
      hydrated: false,
    });
    useShellStore.setState({ section: "runs", overlay: null });
  });

  it("exposes mode agent/studio and harness on/off", () => {
    const ids = shellModeAndHarnessCommands().map((c) => c.id);
    expect(ids).toEqual(["mode:agent", "mode:studio", "harness:on", "harness:off"]);
  });

  it("mode:studio switches modeStore and selects build section", () => {
    const studio = shellModeAndHarnessCommands().find((c) => c.id === "mode:studio");
    expect(studio).toBeDefined();
    studio!.run();
    expect(useModeStore.getState().mode).toBe("studio");
    expect(useShellStore.getState().section).toBe("build");
  });

  it("mode:agent switches back to agent and threads section", () => {
    useModeStore.getState().setMode("studio");
    useShellStore.setState({ section: "build", rightOpen: true });
    const agent = shellModeAndHarnessCommands().find((c) => c.id === "mode:agent");
    agent!.run();
    expect(useModeStore.getState().mode).toBe("agent");
    expect(useShellStore.getState().section).toBe("threads");
    expect(useShellStore.getState().rightOpen).toBe(false);
  });

  it("mode:studio opens inspector", () => {
    useShellStore.setState({ rightOpen: false });
    shellModeAndHarnessCommands().find((c) => c.id === "mode:studio")!.run();
    expect(useShellStore.getState().rightOpen).toBe(true);
  });

  it("harness on/off toggles harnessSessionStore.enabled", () => {
    const cmds = shellModeAndHarnessCommands();
    cmds.find((c) => c.id === "harness:off")!.run();
    expect(useHarnessSessionStore.getState().enabled).toBe(false);
    cmds.find((c) => c.id === "harness:on")!.run();
    expect(useHarnessSessionStore.getState().enabled).toBe(true);
  });
});

describe("shellOverlayCommands", () => {
  beforeEach(() => {
    useShellStore.setState({ overlay: null, paletteOpen: false });
  });

  it("exposes cowork, automations, and pull-requests commands", () => {
    const cmds = shellOverlayCommands();
    expect(cmds.map((c) => c.id)).toEqual([
      "overlay:cowork",
      "overlay:automations",
      "overlay:git",
    ]);
    expect(cmds.find((c) => c.id === "overlay:git")!.label).toBe(
      "Open Pull requests"
    );
  });

  it("Open Cowork sets overlay to cowork", () => {
    shellOverlayCommands().find((c) => c.id === "overlay:cowork")!.run();
    expect(useShellStore.getState().overlay).toBe("cowork");
  });

  it("Open Automations sets overlay to automations", () => {
    shellOverlayCommands().find((c) => c.id === "overlay:automations")!.run();
    expect(useShellStore.getState().overlay).toBe("automations");
  });

  it("Open Pull requests sets overlay to git", () => {
    shellOverlayCommands().find((c) => c.id === "overlay:git")!.run();
    expect(useShellStore.getState().overlay).toBe("git");
  });
});
