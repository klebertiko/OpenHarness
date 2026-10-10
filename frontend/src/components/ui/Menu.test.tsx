import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Menu, MenuItem, MenuSeparator } from "./Menu";

afterEach(cleanup);

function Example({ onPick = vi.fn() }: { onPick?: () => void }) {
  return (
    <div>
      <Menu label="File" trigger="File">
        <MenuItem onSelect={onPick}>Open</MenuItem>
        <MenuItem disabled onSelect={vi.fn()}>Locked</MenuItem>
        <MenuSeparator />
        <MenuItem keepOpen onSelect={vi.fn()}>Expand</MenuItem>
        <MenuItem checked onSelect={vi.fn()}>Mock</MenuItem>
      </Menu>
      <button type="button">Elsewhere</button>
    </div>
  );
}

it("opens from its button, names itself, and lands focus on the first enabled item", async () => {
  const user = userEvent.setup();
  render(<Example />);
  const trigger = screen.getByRole("button", { name: "File" });
  expect(trigger.getAttribute("aria-haspopup")).toBe("menu");
  expect(trigger.getAttribute("aria-expanded")).toBe("false");
  expect(screen.queryByRole("menu")).toBeNull();
  await user.click(trigger);
  expect(screen.getByRole("menu", { name: "File" })).toBeTruthy();
  expect(trigger.getAttribute("aria-expanded")).toBe("true");
  expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "Open" }));
});

it("moves with the arrow keys, skips disabled items, wraps, and checked items are radios", async () => {
  const user = userEvent.setup();
  render(<Example />);
  await user.click(screen.getByRole("button", { name: "File" }));
  await user.keyboard("{ArrowDown}");
  expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "Expand" }));
  await user.keyboard("{ArrowDown}");
  expect(document.activeElement).toBe(screen.getByRole("menuitemradio", { name: "Mock" }));
  expect(screen.getByRole("menuitemradio", { name: "Mock" }).getAttribute("aria-checked")).toBe("true");
  await user.keyboard("{ArrowDown}");
  expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "Open" }));
  await user.keyboard("{End}");
  expect(document.activeElement).toBe(screen.getByRole("menuitemradio", { name: "Mock" }));
  await user.keyboard("{Home}");
  expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "Open" }));
});

it("closes on Escape and gives focus back to the button", async () => {
  const user = userEvent.setup();
  render(<Example />);
  const trigger = screen.getByRole("button", { name: "File" });
  await user.click(trigger);
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("menu")).toBeNull();
  expect(document.activeElement).toBe(trigger);
});

it("closes when the pointer goes elsewhere", async () => {
  const user = userEvent.setup();
  render(<Example />);
  await user.click(screen.getByRole("button", { name: "File" }));
  await user.click(screen.getByRole("button", { name: "Elsewhere" }));
  expect(screen.queryByRole("menu")).toBeNull();
});

it("runs an item and closes, unless the item keeps the menu open; a disabled item does nothing", async () => {
  const user = userEvent.setup();
  const onPick = vi.fn();
  render(<Example onPick={onPick} />);
  await user.click(screen.getByRole("button", { name: "File" }));
  await user.click(screen.getByRole("menuitem", { name: "Locked" }));
  expect(screen.getByRole("menu")).toBeTruthy();
  await user.click(screen.getByRole("menuitem", { name: "Expand" }));
  expect(screen.getByRole("menu")).toBeTruthy();
  await user.click(screen.getByRole("menuitem", { name: "Open" }));
  expect(onPick).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole("menu")).toBeNull();
});

it("a disabled menu button does not open", async () => {
  const user = userEvent.setup();
  render(<Menu label="Run options" trigger="Mock" disabled><MenuItem onSelect={vi.fn()}>x</MenuItem></Menu>);
  await user.click(screen.getByRole("button", { name: "Run options" }));
  expect(screen.queryByRole("menu")).toBeNull();
});
