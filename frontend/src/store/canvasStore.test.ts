import { beforeEach, describe, expect, it } from "vitest";
import { useCanvasStore } from "./canvasStore";
import type { HarnessNode } from "@/lib/types";

/**
 * Coverage for the HITL-pause state the Studio canvas needs: which node is
 * parked awaiting a person, and what question/context came with the pause.
 * See frontend/src/lib/actions.ts (`run()`'s `hitl_pause`/`hitl_resolved`
 * handling) for how this gets populated from the live SSE stream.
 */
const hitlNode: HarnessNode = {
  id: "hitl-1",
  type: "hitl",
  position: { x: 0, y: 0 },
  data: { label: "Review Gate", status: "running" },
};

describe("canvasStore — awaitingHuman", () => {
  beforeEach(() => {
    useCanvasStore.setState({
      nodes: [hitlNode],
      edges: [],
      awaitingHuman: null,
      isRunning: false,
    });
  });

  it("defaults to null", () => {
    expect(useCanvasStore.getState().awaitingHuman).toBeNull();
  });

  it("setAwaitingHuman stores the paused node's id, question and context", () => {
    useCanvasStore.getState().setAwaitingHuman({
      nodeId: "hitl-1",
      question: "Approve this step and continue the run?",
      context: "upstream output to review",
    });

    expect(useCanvasStore.getState().awaitingHuman).toEqual({
      nodeId: "hitl-1",
      question: "Approve this step and continue the run?",
      context: "upstream output to review",
    });
  });

  it("setAwaitingHuman(null) clears it", () => {
    useCanvasStore.getState().setAwaitingHuman({ nodeId: "hitl-1", question: "q", context: "" });
    useCanvasStore.getState().setAwaitingHuman(null);
    expect(useCanvasStore.getState().awaitingHuman).toBeNull();
  });

  it("resetExecution clears a stale awaitingHuman left over from a previous run", () => {
    useCanvasStore.getState().setAwaitingHuman({ nodeId: "hitl-1", question: "q", context: "" });
    useCanvasStore.getState().resetExecution();
    expect(useCanvasStore.getState().awaitingHuman).toBeNull();
  });

  it("does not disturb other nodes' state", () => {
    useCanvasStore.setState({
      nodes: [
        hitlNode,
        { id: "llm-1", type: "agent", position: { x: 0, y: 0 }, data: { label: "Implementer" } },
      ],
    });
    useCanvasStore.getState().setAwaitingHuman({ nodeId: "hitl-1", question: "q", context: "" });
    const other = useCanvasStore.getState().nodes.find((n) => n.id === "llm-1")!;
    expect(other.data.status).toBeUndefined();
  });
});
