import { afterEach, beforeEach, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NodePalette } from "../sidebar/NodePalette";
import { PropertiesPanel } from "../sidebar/PropertiesPanel";
import { useCanvasStore } from "@/store/canvasStore";

beforeEach(() => useCanvasStore.getState().loadGraph([], []));
afterEach(cleanup);

it("adds a block with the keyboard and exposes its selected settings", async () => {
  const user = userEvent.setup();
  render(<><NodePalette /><PropertiesPanel /></>);
  const add = screen.getByRole("button", { name: "Add Agent" });
  add.focus();
  await user.keyboard("{Enter}");
  const label = screen.getByRole("textbox", { name: "Label" }) as HTMLInputElement;
  expect(label.value).toBe("Agent");
  await user.clear(label);
  await user.type(label, "Research assistant");
  expect(screen.getByText("Research assistant")).toBeTruthy();
});
