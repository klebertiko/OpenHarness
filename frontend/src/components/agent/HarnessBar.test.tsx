import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { useShellStore } from "@/components/shell/shellStore";
import { useModeStore } from "@/store/modeStore";

import { HarnessBar } from "./HarnessBar";

vi.mock("./HarnessSwitch", () => ({
  HarnessSwitch: () => <div data-testid="harness-switch-stub" />,
}));

describe("HarnessBar", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    useModeStore.setState({ mode: "agent" });
    useShellStore.setState({ section: "threads" });
  });

  it("renders Open in Studio and Providers chip", () => {
    render(<HarnessBar />);
    const bar = screen.getByTestId("harness-bar");
    expect(within(bar).getByRole("button", { name: /open in studio/i })).toBeTruthy();
    expect(within(bar).getByTitle("Open Providers")).toBeTruthy();
    expect(within(bar).getByText("…")).toBeTruthy();
  });

  it("Open in Studio sets modeStore to studio", async () => {
    const user = userEvent.setup();
    render(<HarnessBar />);
    const bar = screen.getByTestId("harness-bar");
    await user.click(within(bar).getByRole("button", { name: /open in studio/i }));
    expect(useModeStore.getState().mode).toBe("studio");
  });

  it("Providers chip sets shellStore section to providers", async () => {
    const user = userEvent.setup();
    render(<HarnessBar />);
    const bar = screen.getByTestId("harness-bar");
    await user.click(within(bar).getByTitle("Open Providers"));
    expect(useShellStore.getState().section).toBe("providers");
  });
});
