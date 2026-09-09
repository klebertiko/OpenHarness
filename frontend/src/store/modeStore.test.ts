import { beforeEach, describe, expect, it } from "vitest";
import { useModeStore } from "./modeStore";

describe("modeStore", () => {
  beforeEach(() => {
    useModeStore.setState({ mode: "agent" });
  });

  it("defaults to agent mode", () => {
    expect(useModeStore.getState().mode).toBe("agent");
  });

  it("setMode switches to studio", () => {
    useModeStore.getState().setMode("studio");
    expect(useModeStore.getState().mode).toBe("studio");
  });

  it("setMode switches back to agent", () => {
    useModeStore.getState().setMode("studio");
    useModeStore.getState().setMode("agent");
    expect(useModeStore.getState().mode).toBe("agent");
  });
});
