import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ShellOverlayHost } from "./ShellOverlayHost";
import { useShellStore } from "./shellStore";

vi.mock("@/components/cowork/CoworkPanel", () => ({
  CoworkPanel: () => <div data-testid="cowork-panel">Cowork body</div>,
}));
vi.mock("@/components/automations/AutomationsPanel", () => ({
  AutomationsPanel: () => (
    <div data-testid="automations-panel">Automations body</div>
  ),
}));
vi.mock("@/components/git/GitPanel", () => ({
  GitPanel: () => <div data-testid="git-panel">PR body</div>,
}));

describe("ShellOverlayHost", () => {
  beforeEach(() => {
    useShellStore.setState({ overlay: null });
  });

  afterEach(() => {
    cleanup();
  });

  it("renders nothing when overlay is null", () => {
    const { container } = render(<ShellOverlayHost />);
    expect(container.firstChild).toBeNull();
  });

  it("shows Pull requests title for git overlay (not Git)", () => {
    useShellStore.setState({ overlay: "git" });
    render(<ShellOverlayHost />);
    expect(screen.getByRole("dialog", { name: "Pull requests" })).toBeTruthy();
    expect(screen.queryByRole("dialog", { name: "Git" })).toBeNull();
    expect(screen.getByTestId("git-panel")).toBeTruthy();
  });

  it("mounts Cowork panel when overlay is cowork", () => {
    useShellStore.setState({ overlay: "cowork" });
    render(<ShellOverlayHost />);
    expect(screen.getByRole("dialog", { name: "Cowork" })).toBeTruthy();
    expect(screen.getByTestId("cowork-panel")).toBeTruthy();
  });

  it("close button clears overlay", async () => {
    const user = userEvent.setup();
    useShellStore.setState({ overlay: "automations" });
    render(<ShellOverlayHost />);
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(useShellStore.getState().overlay).toBeNull();
  });
});
