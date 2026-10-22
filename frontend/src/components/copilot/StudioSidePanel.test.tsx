import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ReactFlowProvider } from "@xyflow/react";
import { useCanvasStore } from "@/store/canvasStore";
import { useCopilotStore } from "@/store/copilotStore";
import { StudioSidePanel } from "./StudioSidePanel";

const renderPanel = () => render(<ReactFlowProvider><StudioSidePanel /></ReactFlowProvider>);

beforeEach(() => {
  useCanvasStore.getState().loadGraph([{ id: "a1", type: "agent", position: { x: 0, y: 0 }, data: { label: "Writer" } }], []);
  useCopilotStore.getState().reset();
  useCopilotStore.setState({ open: false, tab: "inspector" });
});
afterEach(cleanup);

describe("StudioSidePanel", () => {
  it("exposes Inspector and Nilo as a tablist with the active tab selected", () => {
    renderPanel();
    const tabs = screen.getAllByRole("tab");
    expect(screen.getByRole("tablist")).toBeTruthy();
    expect(tabs.map((t) => t.textContent?.startsWith("Inspector") || t.textContent === "Nilo")).toEqual([true, true]);
    expect(screen.getByRole("tab", { name: /Inspector/ }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tabpanel")).toBeTruthy();
  });

  it("arrow keys move between tabs and switch the panel", async () => {
    const user = userEvent.setup();
    renderPanel();
    screen.getByRole("tab", { name: /Inspector/ }).focus();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "Nilo" }).getAttribute("aria-selected")).toBe("true");
    expect(useCopilotStore.getState().tab).toBe("copilot");
    expect(screen.getByText("Build the graph in plain language")).toBeTruthy();
    await user.keyboard("{ArrowLeft}");
    expect(useCopilotStore.getState().tab).toBe("inspector");
  });

  it("selecting a node while on Copilot does not steal the tab, and hints on the Inspector tab", () => {
    useCopilotStore.setState({ open: true, tab: "copilot" });
    renderPanel();
    expect(screen.getByRole("tab", { name: "Inspector" })).toBeTruthy();
    act(() => useCanvasStore.getState().setSelectedNode("a1"));
    expect(useCopilotStore.getState().tab).toBe("copilot");
    expect(screen.getByRole("tab", { name: /Inspector · 1 selected/ })).toBeTruthy();
  });
});
