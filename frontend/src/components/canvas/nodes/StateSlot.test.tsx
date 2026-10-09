import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { StateSlot } from "./BaseNode";

afterEach(cleanup);

describe("StateSlot copilot marks", () => {
  it("shows + new and ~ edited for an idle node with a pending Copilot mark", () => {
    const { rerender } = render(<StateSlot data={{ label: "A" }} type="agent" mark="added" />);
    expect(screen.getByText("+ new")).toBeTruthy();
    rerender(<StateSlot data={{ label: "A" }} type="agent" mark="changed" />);
    expect(screen.getByText("~ edited")).toBeTruthy();
  });

  it("lets running, error and held states take precedence over a mark", () => {
    for (const [status, text] of [["running", "running"], ["error", "error"], ["paused", "held"]] as const) {
      const { unmount } = render(<StateSlot data={{ label: "A", status }} type="agent" mark="added" />);
      expect(screen.getByText(text)).toBeTruthy();
      expect(screen.queryByText("+ new")).toBeNull();
      unmount();
    }
  });

  it("falls back to the role code with no mark", () => {
    render(<StateSlot data={{ label: "A" }} type="agent" />);
    expect(screen.queryByText("+ new")).toBeNull();
    expect(screen.queryByText("~ edited")).toBeNull();
  });
});
