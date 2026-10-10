import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const executeMock = vi.fn();
vi.mock("@/lib/api", () => ({
  api: {
    execute: (...args: unknown[]) => executeMock(...args),
    harnesses: { update: vi.fn(), create: vi.fn() },
  },
}));

import { useCanvasStore } from "@/store/canvasStore";
import { useReadinessStore } from "@/components/studio/readinessStore";
import type { Readiness } from "./readiness";
import { useHarnessActions } from "./actions";

const node = { id: "a", type: "agent" as const, position: { x: 0, y: 0 }, data: { label: "Writer" } };
const summary = (state: "ready" | "problems" | "review" | "checking" | "offline", blocking = false): Readiness =>
  ({ state, label: state, problems: [], blocking });

describe("Run is the one door to execution, and it explains instead of failing late", () => {
  beforeEach(() => {
    executeMock.mockReset();
    useReadinessStore.setState({ summary: summary("ready"), panel: null });
    useCanvasStore.setState({ nodes: [node], edges: [], isRunning: false, executionMode: "mock" });
  });

  it("starts the run when the harness is ready", () => {
    const { result } = renderHook(() => useHarnessActions());
    result.current.run();
    expect(executeMock).toHaveBeenCalledTimes(1);
    expect(useCanvasStore.getState().isRunning).toBe(true);
  });

  it("opens the Problems panel instead of running a harness the engine rejects", () => {
    useReadinessStore.setState({ summary: summary("problems", true) });
    const { result } = renderHook(() => useHarnessActions());
    result.current.run();
    expect(executeMock).not.toHaveBeenCalled();
    expect(useCanvasStore.getState().isRunning).toBe(false);
    expect(useReadinessStore.getState().panel).toBe("problems");
  });

  it("does not block on things merely worth a look, a pending check, or an unreachable engine", () => {
    for (const state of ["review", "checking", "offline"] as const) {
      executeMock.mockReset();
      useCanvasStore.setState({ isRunning: false });
      useReadinessStore.setState({ summary: summary(state) });
      renderHook(() => useHarnessActions()).result.current.run();
      expect(executeMock).toHaveBeenCalledTimes(1);
    }
  });

  it("has no second copy of the file verbs: export, import and save live in the File menu's actions", () => {
    const keys = Object.keys(renderHook(() => useHarnessActions()).result.current).sort();
    expect(keys).toEqual(["resolveHitl", "run", "stop"]);
  });
});
