import { beforeEach, describe, expect, it } from "vitest";
import { shellModeAndHarnessCommands } from "./commands";
import { useModeStore } from "@/store/modeStore";
import { useHarnessSessionStore } from "@/store/harnessSessionStore";

describe("shellModeAndHarnessCommands", () => {
  beforeEach(() => {
    useModeStore.setState({ mode: "agent" });
    useHarnessSessionStore.setState({
      enabled: true,
      activeBundle: null,
      hydrated: false,
    });
  });

  it("exposes mode agent/studio and harness on/off", () => {
    const ids = shellModeAndHarnessCommands().map((c) => c.id);
    expect(ids).toEqual(["mode:agent", "mode:studio", "harness:on", "harness:off"]);
  });

  it("mode:studio switches modeStore without navigation", () => {
    const studio = shellModeAndHarnessCommands().find((c) => c.id === "mode:studio");
    expect(studio).toBeDefined();
    studio!.run();
    expect(useModeStore.getState().mode).toBe("studio");
  });

  it("mode:agent switches back to agent", () => {
    useModeStore.getState().setMode("studio");
    const agent = shellModeAndHarnessCommands().find((c) => c.id === "mode:agent");
    agent!.run();
    expect(useModeStore.getState().mode).toBe("agent");
  });

  it("harness on/off toggles harnessSessionStore.enabled", () => {
    const cmds = shellModeAndHarnessCommands();
    cmds.find((c) => c.id === "harness:off")!.run();
    expect(useHarnessSessionStore.getState().enabled).toBe(false);
    cmds.find((c) => c.id === "harness:on")!.run();
    expect(useHarnessSessionStore.getState().enabled).toBe(true);
  });
});
