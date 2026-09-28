import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it } from "vitest";
import { useCanvasStore } from "@/store/canvasStore";
import { PropertiesPanel } from "./PropertiesPanel";

/**
 * Per-agent token limit — the Inspector field a person sets under harness
 * (backend/engine.py reads `data.tokenLimit` from the same graph JSON this
 * panel edits, no separate wiring). Additive next to the existing Max
 * Tokens/Temperature fields; this test only covers the new field, not the
 * ones already covered elsewhere (e.g. PropertiesPanel.provider.test.tsx).
 */

const initialCanvas = useCanvasStore.getState();
beforeEach(() => {
  useCanvasStore.setState({
    nodes: [{ id: "author", type: "agent", position: { x: 0, y: 0 }, data: { label: "Author", roleId: "BE" } }],
    edges: [],
    selectedNodeId: "author",
  });
});
afterEach(() => {
  cleanup();
  useCanvasStore.setState(initialCanvas);
});

it("has no limit by default and shows the 'no limit' placeholder", () => {
  render(<PropertiesPanel />);
  const input = screen.getByLabelText("Token Limit (budget)") as HTMLInputElement;
  expect(input.value).toBe("");
  expect(input.placeholder).toBe("no limit");
});

it("typing a limit writes it onto the node's data", async () => {
  const user = userEvent.setup();
  render(<PropertiesPanel />);
  const input = screen.getByLabelText("Token Limit (budget)");
  await user.type(input, "5000");
  expect(useCanvasStore.getState().nodes[0].data.tokenLimit).toBe(5000);
});

it("clearing the field removes the limit rather than coercing to 0", async () => {
  const user = userEvent.setup();
  useCanvasStore.setState({
    nodes: [
      {
        id: "author",
        type: "agent",
        position: { x: 0, y: 0 },
        data: { label: "Author", roleId: "BE", tokenLimit: 5000 },
      },
    ],
  });
  render(<PropertiesPanel />);
  const input = screen.getByLabelText("Token Limit (budget)") as HTMLInputElement;
  expect(input.value).toBe("5000");
  await user.clear(input);
  expect(useCanvasStore.getState().nodes[0].data.tokenLimit).toBeUndefined();
});
