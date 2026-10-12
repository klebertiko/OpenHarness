import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { HarnessCanvas } from "./HarnessCanvas";
import { useCanvasStore } from "@/store/canvasStore";
import type { HarnessEdge, HarnessNode } from "@/lib/types";

const fitView = vi.fn();

vi.mock("@xyflow/react", async (orig) => ({
  ...(await orig<typeof import("@xyflow/react")>()),
  // A new fitView identity on every render, like a real re-render storm.
  useReactFlow: () => ({
    fitView: (...a: unknown[]) => fitView(...a),
    screenToFlowPosition: (p: unknown) => p,
    zoomIn: vi.fn(), zoomOut: vi.fn(), zoomTo: vi.fn(),
  }),
  useNodesInitialized: () => false,
  useStore: (sel: (s: unknown) => unknown) => sel({ width: 0, transform: [0, 0, 1] }),
  ReactFlow: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Background: () => null,
  MiniMap: () => null,
}));
vi.mock("./nodes", () => ({ nodeTypes: {} }));
vi.mock("./edges/HarnessWire", () => ({ edgeTypes: {}, WireTips: () => null }));
vi.mock("./GraphAudit", () => ({ GraphAudit: () => null }));

const node = (id: string): HarnessNode => ({ id, type: "agent", position: { x: 0, y: 0 }, data: { label: id } as HarnessNode["data"] });
const edge: HarnessEdge = { id: "a-b", source: "a", target: "b" };

beforeEach(() => {
  fitView.mockClear();
  useCanvasStore.setState({ isRunning: false });
  useCanvasStore.getState().loadGraph([node("a"), node("b")], [edge]);
});
afterEach(cleanup);

it("re-frames the view after Auto-arrange, even if the component re-renders before the frame", async () => {
  const { rerender } = render(<HarnessCanvas />);
  act(() => { useCanvasStore.getState().arrangeGraph(); });
  rerender(<HarnessCanvas />); // new fitView identity: the effect re-runs and cancels the pending frame
  rerender(<HarnessCanvas />);
  await waitFor(() => expect(fitView).toHaveBeenCalledWith(expect.objectContaining({ padding: 0.16 })));
});

it("re-frames once per arrange, not on unrelated renders", async () => {
  const { rerender } = render(<HarnessCanvas />);
  act(() => { useCanvasStore.getState().arrangeGraph(); });
  await waitFor(() => expect(fitView).toHaveBeenCalledTimes(1));
  rerender(<HarnessCanvas />);
  await new Promise((r) => setTimeout(r, 50));
  expect(fitView).toHaveBeenCalledTimes(1);
});
