import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useCanvasStore } from "@/store/canvasStore";
import { useShellStore } from "@/components/shell/shellStore";
import { openBundledHarness, newStudioHarness, openStudioPreset } from "@/lib/studio";
import { api } from "@/lib/api";
import { useStudioDocsStore } from "@/lib/studioDocuments";
import { StudioOverview } from "./StudioOverview";

vi.mock("@/lib/studio", () => ({ openBundledHarness: vi.fn(), newStudioHarness: vi.fn(), openStudioPreset: vi.fn() }));
vi.mock("@/lib/api", () => ({
  api: { harnesses: { list: vi.fn(), get: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() } },
}));
const h = vi.mocked(api.harnesses);
const rec = (id: string, name: string) => ({ id, name, description: "", created_at: "2026-10-05T10:00:00", updated_at: "2026-10-05T10:00:00" });

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  h.list.mockResolvedValue([]);
  h.delete.mockResolvedValue(new Response(null, { status: 204 }));
  useCanvasStore.setState({ isRunning: false, nodes: [], edges: [], harnessMeta: { id: null, name: "Untitled harness", description: "" } });
  useShellStore.setState({ section: "studio", studioView: "overview", libraryOpen: false });
  useStudioDocsStore.setState({ items: [], loaded: false, error: "", saveState: "idle" });
});

it("an untouched new harness is not shown as a draft", async () => {
  render(<StudioOverview />);
  expect(await screen.findByText(/Nothing saved yet/)).toBeTruthy();
  expect(screen.queryByText("Untitled harness")).toBeNull();
  expect(screen.queryByRole("button", { name: /Continue editing/ })).toBeNull();
});

it("lists saved harnesses from the local engine and opens one", async () => {
  h.list.mockResolvedValue([rec("h1", "Triage loop"), rec("h2", "Review crew")]);
  h.get.mockResolvedValue({ ...rec("h2", "Review crew"), graph_json: { nodes: [], edges: [] } });
  render(<StudioOverview />);
  expect(await screen.findByRole("heading", { name: "Triage loop" })).toBeTruthy();
  await userEvent.setup().click(screen.getByRole("button", { name: "Open Review crew" }));
  await waitFor(() => expect(useShellStore.getState().studioView).toBe("editor"));
  expect(useCanvasStore.getState().harnessMeta.id).toBe("h2");
});

it("deletes a saved harness only after confirmation, and cancel keeps it", async () => {
  h.list.mockResolvedValue([rec("h1", "Triage loop")]);
  render(<StudioOverview />);
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Delete Triage loop" }));
  expect(screen.getByText(/Delete “Triage loop” from this device/)).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  expect(h.delete).not.toHaveBeenCalled();
  await waitFor(() => expect(document.activeElement?.getAttribute("aria-label")).toBe("Delete Triage loop"));
  expect(screen.getByRole("heading", { name: "Triage loop" })).toBeTruthy();

  await user.click(screen.getByRole("button", { name: "Delete Triage loop" }));
  await user.click(screen.getByRole("button", { name: "Delete" }));
  await waitFor(() => expect(h.delete).toHaveBeenCalledWith("h1"));
  await waitFor(() => expect(screen.queryByRole("heading", { name: "Triage loop" })).toBeNull());
});

it("the open harness offers Continue editing", async () => {
  h.list.mockResolvedValue([rec("h1", "Triage loop")]);
  useCanvasStore.setState({ harnessMeta: { id: "h1", name: "Triage loop", description: "" } });
  render(<StudioOverview />);
  await userEvent.setup().click(await screen.findByRole("button", { name: "Continue editing Triage loop" }));
  expect(useShellStore.getState().studioView).toBe("editor");
  expect(screen.getByText("Open now")).toBeTruthy();
});

it("reports an unreachable engine and retries", async () => {
  h.list.mockRejectedValueOnce(new Error("down"));
  render(<StudioOverview />);
  expect((await screen.findByRole("alert")).textContent).toMatch(/local engine/);
  h.list.mockResolvedValue([rec("h1", "Triage loop")]);
  await userEvent.setup().click(screen.getByRole("button", { name: "Retry" }));
  expect(await screen.findByRole("heading", { name: "Triage loop" })).toBeTruthy();
});

it("identifies the local sample and opens the bundled framework through its loader", async () => {
  vi.mocked(openBundledHarness).mockResolvedValue(undefined);
  render(<StudioOverview />);
  expect(screen.getByRole("heading", { name: "Harness Studio" })).toBeTruthy();
  expect(screen.getByText("OpenHarness sample")).toBeTruthy();
  expect(screen.getByText("skills-framework · bundled snapshot")).toBeTruthy();
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Open framework" }));
  await waitFor(() => expect(openBundledHarness).toHaveBeenCalledOnce());
  await user.click(screen.getByRole("button", { name: "Open sample" }));
  await waitFor(() => expect(openStudioPreset).toHaveBeenCalledOnce());
});

it("shows a loading failure and allows retry", async () => {
  vi.mocked(openBundledHarness).mockRejectedValue(new Error("offline"));
  render(<StudioOverview />);
  await userEvent.setup().click(screen.getByRole("button", { name: "Open framework" }));
  expect((await screen.findByText(/Could not load the bundled harness/))).toBeTruthy();
  expect((screen.getByRole("button", { name: "Open framework" }) as HTMLButtonElement).disabled).toBe(false);
});

it("exposes new/import actions", async () => {
  render(<StudioOverview />);
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Open .ohm" }));
  expect(useShellStore.getState().libraryOpen).toBe(true);
  await user.click(screen.getByRole("button", { name: "New harness" }));
  await waitFor(() => expect(newStudioHarness).toHaveBeenCalledOnce());
});

it("keeps an active run available to inspect while blocking replacement starters", async () => {
  h.list.mockResolvedValue([rec("h1", "Triage loop")]);
  useCanvasStore.setState({ isRunning: true, harnessMeta: { id: "h1", name: "Triage loop", description: "" } });
  render(<StudioOverview />);
  await screen.findByRole("heading", { name: "Triage loop" });
  for (const name of ["New harness", "Open .ohm", "Open sample", "Open framework", "Delete Triage loop"]) {
    expect((screen.getByRole("button", { name }) as HTMLButtonElement).disabled).toBe(true);
  }
  expect((screen.getByRole("button", { name: /Continue editing/ }) as HTMLButtonElement).disabled).toBe(false);
});

it("an opened but unedited starting point says it isn't saved yet, never 'Saving…'", async () => {
  useCanvasStore.setState({ nodes: [{ id: "a", type: "agent", position: { x: 0, y: 0 }, data: { label: "a" } } as never], harnessMeta: { id: null, name: "Agent + review", description: "" } });
  useStudioDocsStore.setState({ dirty: false });
  render(<StudioOverview />);
  expect(await screen.findByText(/saved here once you change it/)).toBeTruthy();
  expect(screen.queryByText("Saving…")).toBeNull();
});

it("an edited, not-yet-saved harness says Saving…", async () => {
  useCanvasStore.setState({ nodes: [{ id: "a", type: "agent", position: { x: 0, y: 0 }, data: { label: "a" } } as never], harnessMeta: { id: null, name: "Mine", description: "" } });
  useStudioDocsStore.setState({ dirty: true, saveState: "saving" });
  render(<StudioOverview />);
  expect(await screen.findByText("Saving…")).toBeTruthy();
});

it("Escape cancels a delete confirmation and returns focus to the row", async () => {
  h.list.mockResolvedValue([rec("h1", "Triage loop")]);
  render(<StudioOverview />);
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Delete Triage loop" }));
  expect(screen.getByText(/Delete “Triage loop” from this device/)).toBeTruthy();
  await user.keyboard("{Escape}");
  expect(screen.queryByText(/Delete “Triage loop” from this device/)).toBeNull();
  expect(h.delete).not.toHaveBeenCalled();
  await waitFor(() => expect(document.activeElement?.getAttribute("aria-label")).toBe("Delete Triage loop"));
});
