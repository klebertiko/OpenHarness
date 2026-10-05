import { afterEach, beforeEach, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { useShellStore, LEFT_MIN, RAIL_COLLAPSED } from "./shellStore";
import { ActivityRail } from "./ActivityRail";

beforeEach(() => {
  useShellStore.setState({ hydrated: true, leftWidth: 216 });
});
afterEach(cleanup);

it("uses the saved left width when the panel is not suppressed", () => {
  render(<ActivityRail />);
  const nav = screen.getByRole("navigation", { name: "Destinations" });
  expect(nav.style.width).toBe("216px");
  expect(nav.style.minWidth).toBe(`${LEFT_MIN}px`);
});

it("shrinks to the icon-only width when the left panel is suppressed", () => {
  render(<ActivityRail collapsed />);
  const nav = screen.getByRole("navigation", { name: "Destinations" });
  expect(nav.style.width).toBe(`${RAIL_COLLAPSED}px`);
  expect(nav.style.minWidth).toBe(`${RAIL_COLLAPSED}px`);
});
