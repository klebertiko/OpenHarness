import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ReactFlowProvider } from "@xyflow/react";
import { goldenBaseCanvas } from "@/lib/copilot/testGraph";
import { useCanvasStore } from "@/store/canvasStore";
import { useCopilotStore, type Turn } from "@/store/copilotStore";
import { ProposalCard } from "./ProposalCard";

const lines = [
  { glyph: "+" as const, text: 'Agent "Reviewer"' },
  { glyph: "→" as const, text: "Review Gate fail → Reviewer", nodeId: "g1" },
  { glyph: "→" as const, text: "Reviewer → Review Gate" },
];

function seed(state: "open" | "kept" | "undone" = "open") {
  const g = goldenBaseCanvas();
  useCanvasStore.setState({ isRunning: false, _history: [], _historyIndex: -1 });
  useCanvasStore.getState().loadGraph(g.nodes, g.edges);
  const turn: Turn = {
    id: "t1",
    role: "assistant",
    text: "Added a Reviewer.",
    proposal: { seq: useCanvasStore.getState().headSeq(), lines, state },
  };
  useCopilotStore.setState({ turns: [turn], marks: {}, tab: "copilot", open: true });
  return turn;
}

const renderCard = (turn: Turn) =>
  render(<ReactFlowProvider><ProposalCard turnId={turn.id} proposal={turn.proposal!} /></ReactFlowProvider>);

afterEach(cleanup);
beforeEach(() => useCopilotStore.getState().reset());

describe("ProposalCard", () => {
  it("renders the header and one line per op", () => {
    renderCard(seed());
    expect(screen.getByText("Proposed changes · 3")).toBeTruthy();
    expect(screen.getByText('Agent "Reviewer"')).toBeTruthy();
    expect(screen.getByText("Review Gate fail → Reviewer")).toBeTruthy();
  });

  it("Keep collapses to Kept 3 changes", async () => {
    const turn = seed();
    const { rerender } = renderCard(turn);
    await userEvent.setup().click(screen.getByRole("button", { name: "Keep" }));
    expect(useCopilotStore.getState().turns[0].proposal!.state).toBe("kept");
    const kept = useCopilotStore.getState().turns[0];
    rerender(<ReactFlowProvider><ProposalCard turnId={kept.id} proposal={kept.proposal!} /></ReactFlowProvider>);
    expect(screen.getByText("Kept 3 changes")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
  });

  it("Undo restores the canvas and collapses to Undone", async () => {
    const turn = seed();
    useCanvasStore.getState().applyGraphPatch([...useCanvasStore.getState().nodes, { id: "x", type: "agent", position: { x: 0, y: 300 }, data: { label: "X" } }], useCanvasStore.getState().edges);
    useCopilotStore.setState({ turns: [{ ...turn, proposal: { ...turn.proposal!, seq: useCanvasStore.getState().headSeq() } }] });
    const fresh = useCopilotStore.getState().turns[0];
    const { rerender } = renderCard(fresh);
    await userEvent.setup().click(screen.getByRole("button", { name: "Undo" }));
    expect(useCanvasStore.getState().nodes).toHaveLength(4);
    const undone = useCopilotStore.getState().turns[0];
    rerender(<ReactFlowProvider><ProposalCard turnId={undone.id} proposal={undone.proposal!} /></ReactFlowProvider>);
    expect(screen.getByText("Undone")).toBeTruthy();
  });

  it("disables Undo with an explanatory title once the graph changed", () => {
    const turn = seed();
    useCanvasStore.getState().addNode({ id: "manual", type: "agent", position: { x: 0, y: 400 }, data: { label: "M" } });
    renderCard(turn);
    const undo = screen.getByRole("button", { name: "Undo" }) as HTMLButtonElement;
    expect(undo.disabled).toBe(true);
    expect(undo.title).toBe("The graph changed since — use Undo (Mod+Z)");
  });

  it("clicking a line with a node selects it and switches to the Inspector tab", async () => {
    renderCard(seed());
    await userEvent.setup().click(screen.getByText("Review Gate fail → Reviewer"));
    expect(useCanvasStore.getState().selectedNodeId).toBe("g1");
    expect(useCopilotStore.getState().tab).toBe("inspector");
  });
});
