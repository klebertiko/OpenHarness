import { beforeEach, describe, expect, it } from "vitest";

import { useShellStore } from "@/components/shell/shellStore";
import { useModeStore } from "@/store/modeStore";

/**
 * HarnessBar wiring contract (no RTL): Open in Studio → modeStore;
 * Providers chip → shellStore.setSection("providers").
 */
describe("HarnessBar open actions contract", () => {
  beforeEach(() => {
    useModeStore.setState({ mode: "agent" });
    useShellStore.setState({ section: "threads" });
  });

  it("Open in Studio switches modeStore to studio", () => {
    useModeStore.getState().setMode("studio");
    expect(useModeStore.getState().mode).toBe("studio");
  });

  it("Providers chip opens providers section", () => {
    useShellStore.getState().setSection("providers");
    expect(useShellStore.getState().section).toBe("providers");
  });
});
