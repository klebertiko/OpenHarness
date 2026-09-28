import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { TitleBar } from "./TitleBar";
afterEach(cleanup);
it("limits harness naming to the editor and lets an empty draft be named", () => {
  const props = { harnessName: "Draft", onHarnessNameChange: vi.fn(), mode: "Studio", running: false, nodeCount: 3, onOpenPalette: vi.fn() };
  const { rerender } = render(<TitleBar {...props} editingHarness={false} />);
  expect(screen.queryByLabelText("Harness name")).toBeNull();
  rerender(<TitleBar {...props} nodeCount={0} editingHarness />);
  expect((screen.getByLabelText("Harness name") as HTMLInputElement).value).toBe("Draft");
});
