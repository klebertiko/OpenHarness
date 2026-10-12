import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ReactFlowProvider } from "@xyflow/react";
import { CanvasDock } from "./CanvasDock";
import { useCanvasStore } from "@/store/canvasStore";
import { markClean, startAutosave, useStudioDocsStore } from "@/lib/studioDocuments";
import type { HarnessEdge, HarnessNode } from "@/lib/types";

vi.mock("@/lib/api", () => ({
  api: {
    harnesses: {
      list: vi.fn().mockResolvedValue([]),
      get: vi.fn(),
      create: vi.fn().mockResolvedValue({ id: "h1", name: "x" }),
      update: vi.fn().mockResolvedValue({ id: "h1", name: "x" }),
      delete: vi.fn(),
    },
  },
}));

// A pile: three chained nodes dropped on top of each other, the shape an
// example without stored positions used to open as.
const node = (id: string, x: number, y: number): HarnessNode => ({
  id, type: "agent", position: { x, y }, data: { label: id } as HarnessNode["data"],
});
const edge = (source: string, target: string): HarnessEdge => ({ id: `${source}-${target}`, source, target });
const PILE = [node("a", 0, 0), node("b", 10, 10), node("c", 20, 20)];
const EDGES = [edge("a", "b"), edge("b", "c")];

let stop: (() => void) | null = null;

const renderDock = () =>
  render(
    <ReactFlowProvider>
      <CanvasDock snap={false} onSnap={() => {}} locked={false} onLock={() => {}} panMode={false} onPanMode={() => {}} />
    </ReactFlowProvider>
  );

const positions = () => Object.fromEntries(useCanvasStore.getState().nodes.map((n) => [n.id, n.position]));

beforeEach(() => {
  useCanvasStore.setState({ isRunning: false, harnessMeta: { id: "h1", name: "Mine", description: "" } });
  useCanvasStore.getState().loadGraph(PILE.map((n) => ({ ...n })), EDGES.map((e) => ({ ...e })));
  markClean();
  useStudioDocsStore.setState({ dirty: false, saveState: "idle" });
  stop = startAutosave();
});
afterEach(() => { stop?.(); cleanup(); });

it("Auto-arrange graph lays the nodes out in layers and marks the harness unsaved", async () => {
  const user = userEvent.setup();
  renderDock();
  expect(useStudioDocsStore.getState().dirty).toBe(false);
  await user.click(screen.getByRole("button", { name: /auto-arrange graph/i }));
  const p = positions();
  expect(p.a.x).toBeLessThan(p.b.x);
  expect(p.b.x).toBeLessThan(p.c.x);
  expect(useStudioDocsStore.getState().dirty).toBe(true);
});

it("undo restores the previous positions in one step, and redo re-applies the layout", async () => {
  const user = userEvent.setup();
  renderDock();
  const before = positions();
  await user.click(screen.getByRole("button", { name: /auto-arrange graph/i }));
  const arranged = positions();
  expect(arranged).not.toEqual(before);
  act(() => useCanvasStore.getState().undo());
  expect(positions()).toEqual(before);
  act(() => useCanvasStore.getState().redo());
  expect(positions()).toEqual(arranged);
});

it("keeps ids, data and wiring untouched; it only moves nodes", async () => {
  const user = userEvent.setup();
  renderDock();
  await user.click(screen.getByRole("button", { name: /auto-arrange graph/i }));
  const s = useCanvasStore.getState();
  expect(s.nodes.map((n) => [n.id, n.type, n.data.label])).toEqual(PILE.map((n) => [n.id, n.type, n.data.label]));
  expect(s.edges.map((e) => [e.id, e.source, e.target])).toEqual(EDGES.map((e) => [e.id, e.source, e.target]));
});

it("is disabled while a run owns the graph and when there is nothing to arrange", () => {
  useCanvasStore.setState({ isRunning: true });
  renderDock();
  expect((screen.getByRole("button", { name: /auto-arrange graph/i }) as HTMLButtonElement).disabled).toBe(true);
  cleanup();
  useCanvasStore.setState({ isRunning: false, nodes: [PILE[0]], edges: [] });
  renderDock();
  expect((screen.getByRole("button", { name: /auto-arrange graph/i }) as HTMLButtonElement).disabled).toBe(true);
});

it("does not add an undo step when the graph is already arranged", async () => {
  const user = userEvent.setup();
  renderDock();
  await user.click(screen.getByRole("button", { name: /auto-arrange graph/i }));
  const idx = useCanvasStore.getState()._historyIndex;
  await user.click(screen.getByRole("button", { name: /auto-arrange graph/i }));
  expect(useCanvasStore.getState()._historyIndex).toBe(idx);
});
