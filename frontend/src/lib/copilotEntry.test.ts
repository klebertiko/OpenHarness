import { beforeEach, expect, it, vi } from "vitest";
import { useCopilotStore } from "@/store/copilotStore";
import { useShellStore } from "@/components/shell/shellStore";
import { useCanvasStore } from "@/store/canvasStore";
import { startCopilotFromOverview } from "./copilotEntry";

vi.mock("@/lib/copilot/api", () => ({ planGraphEdit: vi.fn(() => new Promise(() => undefined)) }));

beforeEach(() => {
  useCopilotStore.getState().reset();
  useShellStore.setState({ section: "chats", studioView: "overview", rightOpen: false });
  useCanvasStore.setState({ nodes: [], edges: [], isRunning: false });
});

it("opens a fresh Studio graph, opens Copilot, and sends the description", async () => {
  await startCopilotFromOverview("  Research then review  ");
  expect(useShellStore.getState()).toMatchObject({ section: "studio", studioView: "editor", rightOpen: true });
  expect(useCopilotStore.getState()).toMatchObject({ open: true, tab: "copilot", status: "working" });
  expect(useCopilotStore.getState().turns[0]).toMatchObject({ role: "user", text: "Research then review" });
});

it("refuses an empty description", async () => {
  await expect(startCopilotFromOverview("   ")).rejects.toThrow("Describe the harness first.");
});
