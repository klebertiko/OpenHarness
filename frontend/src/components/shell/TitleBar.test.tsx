import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { TitleBar } from "./TitleBar";

afterEach(cleanup);

const props = {
  harnessName: "Daily work",
  onHarnessNameChange: vi.fn(),
  mode: "Studio",
  running: false,
  nodeCount: 14,
  onOpenPalette: vi.fn(),
};

describe("Contextual header", () => {
  it("keeps document editing and command search accessible", () => {
    render(<TitleBar {...props} />);
    fireEvent.change(screen.getByRole("textbox", { name: "Harness name" }), {
      target: { value: "Research" },
    });
    expect(props.onHarnessNameChange).toHaveBeenCalledWith("Research");
    fireEvent.click(screen.getByRole("button", { name: "Search and commands" }));
    expect(props.onOpenPalette).toHaveBeenCalled();
    expect(screen.queryByText(/blocks in this harness/)).toBeNull();
  });

  it("does not render inactive native window buttons in the browser", () => {
    render(<TitleBar {...props} />);
    for (const name of ["Minimise", "Maximise", "Close"]) {
      expect(screen.queryByRole("button", { name })).toBeNull();
    }
  });

  it("shows running status without presenting an editable harness in Agent", () => {
    render(<TitleBar {...props} mode="Agent" running />);
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.getByRole("status").textContent).toBe("Working…");
  });
});
