import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useCanvasStore } from "@/store/canvasStore";
import { useShellStore } from "@/components/shell/shellStore";
import { openBundledHarness, newStudioHarness } from "@/lib/studio";
import { StudioOverview } from "./StudioOverview";
vi.mock("@/lib/studio", () => ({ openBundledHarness: vi.fn(), newStudioHarness: vi.fn(), openStudioPreset: vi.fn() }));
afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  useCanvasStore.setState({ isRunning: false });
  useShellStore.setState({ section: "studio", studioView: "overview", studioHasDraft: false, libraryOpen: false });
});
it("identifies the local sample and opens the bundled framework through its loader", async () => {
  vi.mocked(openBundledHarness).mockResolvedValue(undefined);
  render(<StudioOverview />);
  expect(screen.getByRole("heading", { name: "Harness Studio" })).toBeTruthy();
  expect(screen.getByText("OpenHarness sample")).toBeTruthy();
  expect(screen.getByText("skills-framework · bundled snapshot")).toBeTruthy();
  await userEvent.setup().click(screen.getByRole("button", { name: "Open framework" }));
  expect(openBundledHarness).toHaveBeenCalledOnce();
});
it("shows a loading failure and allows retry without hiding the draft", async () => {
  vi.mocked(openBundledHarness).mockRejectedValue(new Error("offline"));
  useShellStore.setState({ studioHasDraft: true });
  useCanvasStore.getState().setHarnessMeta({ name: "My draft" });
  render(<StudioOverview />);
  await userEvent.setup().click(screen.getByRole("button", { name: "Open framework" }));
  expect((await screen.findByRole("alert")).textContent).toContain("Could not load");
  expect(screen.getByRole("button", { name: "Continue editing" })).toBeTruthy();
  expect((screen.getByRole("button", { name: "Open framework" }) as HTMLButtonElement).disabled).toBe(false);
});
it("resumes the current draft and exposes new/import actions", async () => {
  useShellStore.setState({ studioHasDraft: true });
  render(<StudioOverview />);
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Continue editing" }));
  expect(useShellStore.getState().studioView).toBe("editor");
  await user.click(screen.getByRole("button", { name: "Open .ohm" }));
  expect(useShellStore.getState().libraryOpen).toBe(true);
  await user.click(screen.getByRole("button", { name: "New harness" }));
  expect(newStudioHarness).toHaveBeenCalledOnce();
});

it("keeps an active run available to inspect while blocking replacement starters", () => {
  useCanvasStore.setState({ isRunning: true });
  useShellStore.setState({ studioHasDraft: true });
  render(<StudioOverview />);
  for (const name of ["New harness", "Open .ohm", "Open sample", "Open framework"]) {
    expect((screen.getByRole("button", { name }) as HTMLButtonElement).disabled).toBe(true);
  }
  expect((screen.getByRole("button", { name: "Continue editing" }) as HTMLButtonElement).disabled).toBe(false);
});
