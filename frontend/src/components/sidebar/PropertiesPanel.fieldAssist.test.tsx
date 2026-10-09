import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { useCanvasStore } from "@/store/canvasStore";
import type { NodeType } from "@/lib/types";
import { PropertiesPanel } from "./PropertiesPanel";

function select(type: NodeType) {
  useCanvasStore.getState().loadGraph([{ id: "n", type, position: { x: 0, y: 0 }, data: { label: "Node" } }], []);
  useCanvasStore.getState().setSelectedNode("n");
}

beforeEach(() => useCanvasStore.setState({ isRunning: false }));
afterEach(cleanup);

describe("PropertiesPanel — Assist placement", () => {
  it("an agent has exactly one Assist, on System Prompt", () => {
    select("agent");
    render(<PropertiesPanel />);
    expect(screen.getAllByRole("button", { name: "Assist" })).toHaveLength(1);
    const label = screen.getByText("System Prompt");
    expect(label.parentElement!.contains(screen.getByRole("button", { name: "Assist" }))).toBe(true);
  });

  it("a skill has Assist on System Prompt", () => {
    select("skill");
    render(<PropertiesPanel />);
    expect(screen.getAllByRole("button", { name: "Assist" })).toHaveLength(1);
  });

  it("a gate has Assist on Checklist", () => {
    select("gate");
    render(<PropertiesPanel />);
    const label = screen.getByText("Checklist");
    expect(label.parentElement!.contains(screen.getByRole("button", { name: "Assist" }))).toBe(true);
    expect(screen.getAllByRole("button", { name: "Assist" })).toHaveLength(1);
  });

  it.each<NodeType>(["hitl", "mcp", "tool"])("%s nodes show no Assist anywhere", (type) => {
    select(type);
    render(<PropertiesPanel />);
    expect(screen.queryByRole("button", { name: "Assist" })).toBeNull();
  });

  it("keeps the textarea labelled by its Field label", () => {
    select("gate");
    render(<PropertiesPanel />);
    expect(screen.getByRole("textbox", { name: "Checklist" })).toBeTruthy();
  });
});
