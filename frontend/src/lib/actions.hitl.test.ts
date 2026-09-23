import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Studio's counterpart to the Chat side's `resolveGate` — see
 * frontend/src/components/agent-run/useRunStream.ts for the reference
 * pattern this mirrors (it already knows how to answer a `hitl_pause`).
 *
 * These tests cover the wiring that was missing before: the Studio run()
 * loop parking on `hitl_pause` instead of ignoring it, and `resolveHitl`
 * sending the same `/execute/{run_id}/control` resume call the Chat side
 * already makes.
 */

const sendControlMock = vi.fn().mockResolvedValue(undefined);
vi.mock("@/components/agent-run/runClient", () => ({
  sendControl: (...args: unknown[]) => sendControlMock(...args),
}));

const executeMock = vi.fn();
vi.mock("@/lib/api", () => ({
  api: {
    execute: (...args: unknown[]) => executeMock(...args),
    harnesses: { update: vi.fn(), create: vi.fn() },
  },
}));

import { useCanvasStore } from "@/store/canvasStore";
import { useActiveRunStore } from "@/store/activeRunStore";
import { useHarnessActions } from "./actions";

describe("useHarnessActions — HITL pause/resolve", () => {
  beforeEach(() => {
    sendControlMock.mockClear();
    executeMock.mockReset();
    useCanvasStore.setState({
      nodes: [{ id: "hitl-1", type: "hitl", position: { x: 0, y: 0 }, data: { label: "Gate" } }],
      edges: [],
      awaitingHuman: null,
      isRunning: false,
    });
    useActiveRunStore.setState({ runId: null });
  });

  it("hitl_pause parks the node and records the question/context", () => {
    let onEvent!: (event: string, data: unknown) => void;
    executeMock.mockImplementation((_payload: unknown, cb: typeof onEvent) => {
      onEvent = cb;
      return () => {};
    });

    const { result } = renderHook(() => useHarnessActions());
    act(() => result.current.run());

    act(() =>
      onEvent("hitl_pause", {
        node_id: "hitl-1",
        question: "Approve this step and continue the run?",
        context: "the implementer's diff",
      })
    );

    const node = useCanvasStore.getState().nodes.find((n) => n.id === "hitl-1")!;
    expect(node.data.status).toBe("paused");
    expect(useCanvasStore.getState().awaitingHuman).toEqual({
      nodeId: "hitl-1",
      question: "Approve this step and continue the run?",
      context: "the implementer's diff",
    });
  });

  it("hitl_resolved clears the paused state", () => {
    let onEvent!: (event: string, data: unknown) => void;
    executeMock.mockImplementation((_payload: unknown, cb: typeof onEvent) => {
      onEvent = cb;
      return () => {};
    });

    const { result } = renderHook(() => useHarnessActions());
    act(() => result.current.run());
    act(() => onEvent("hitl_pause", { node_id: "hitl-1", question: "q", context: "" }));
    expect(useCanvasStore.getState().awaitingHuman).not.toBeNull();

    act(() => onEvent("hitl_resolved", { node_id: "hitl-1", decision: "approve", note: "" }));
    expect(useCanvasStore.getState().awaitingHuman).toBeNull();
  });

  it("resolveHitl sends resume/approve for the active run", () => {
    useActiveRunStore.setState({ runId: "run-42" });
    const { result } = renderHook(() => useHarnessActions());

    act(() => result.current.resolveHitl("approve", ""));

    expect(sendControlMock).toHaveBeenCalledWith("run-42", {
      action: "resume",
      decision: "approve",
      note: "",
    });
  });

  it("resolveHitl sends resume/reject with the reviewer's note", () => {
    useActiveRunStore.setState({ runId: "run-42" });
    const { result } = renderHook(() => useHarnessActions());

    act(() => result.current.resolveHitl("reject", "needs another pass"));

    expect(sendControlMock).toHaveBeenCalledWith("run-42", {
      action: "resume",
      decision: "reject",
      note: "needs another pass",
    });
  });

  it("resolveHitl is a no-op when there is no active run", () => {
    useActiveRunStore.setState({ runId: null });
    const { result } = renderHook(() => useHarnessActions());

    act(() => result.current.resolveHitl("approve", ""));

    expect(sendControlMock).not.toHaveBeenCalled();
  });
});
