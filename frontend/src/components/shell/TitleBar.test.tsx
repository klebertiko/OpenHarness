import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { TitleBar } from "./TitleBar";

afterEach(cleanup);

const props = {
  mode: "Studio",
  running: false,
  onOpenPalette: vi.fn(),
};

describe("Window title bar", () => {
  it("is window chrome only: command search is here, and no harness name field", () => {
    render(<TitleBar {...props} />);
    expect(screen.queryByRole("textbox")).toBeNull();
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

  it("shows running status while a run is going", () => {
    render(<TitleBar {...props} mode="Agent" running />);
    expect(screen.getByRole("status").textContent).toBe("Working…");
  });
});
