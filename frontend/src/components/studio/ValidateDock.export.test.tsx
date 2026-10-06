import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useCanvasStore } from "@/store/canvasStore";
import { useHarnessSessionStore } from "@/store/harnessSessionStore";
import fixture from "@/lib/fixtures/ohm-roundtrip.json";

const saveOhmFileMock = vi.fn();
vi.mock("@/lib/ohmFile", () => ({
  saveOhmFile: (...args: unknown[]) => saveOhmFileMock(...args),
}));

import { ValidateDock } from "./ValidateDock";

describe("ValidateDock .ohm export via the native Save dialog", () => {
  beforeEach(() => {
    saveOhmFileMock.mockReset();
    useCanvasStore.setState({ isRunning: false, nodes: [], edges: [], harnessMeta: { id: null, name: "Untitled", description: "" } });
    useHarnessSessionStore.setState({ activeBundle: structuredClone(fixture) });
  });
  afterEach(() => cleanup());

  const exportButton = () => screen.getByRole("button", { name: "Export .ohm" });

  it("hands the composed bundle to saveOhmFile and shows the saved file name", async () => {
    saveOhmFileMock.mockResolvedValue({ status: "saved", native: true, path: "D:/x/chosen.ohm", name: "chosen.ohm" });
    render(<ValidateDock />);
    fireEvent.click(exportButton());
    await screen.findByText("Saved to chosen.ohm");
    expect(saveOhmFileMock).toHaveBeenCalledTimes(1);
    expect(saveOhmFileMock.mock.calls[0][0]).toMatchObject({ manifest: { id: "roundtrip-test" } });
  });

  it("keeps the existing browser wording when the fallback download ran", async () => {
    saveOhmFileMock.mockResolvedValue({ status: "saved", native: false, name: "h.ohm" });
    render(<ValidateDock />);
    fireEvent.click(exportButton());
    await screen.findByText("Downloaded .ohm");
  });

  it("shows nothing and re-enables the button when the dialog is cancelled", async () => {
    saveOhmFileMock.mockResolvedValue({ status: "cancelled" });
    render(<ValidateDock />);
    fireEvent.click(exportButton());
    await waitFor(() => expect(saveOhmFileMock).toHaveBeenCalled());
    await waitFor(() => expect((exportButton() as HTMLButtonElement).disabled).toBe(false));
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByText(/Saved to|Downloaded|Exporting/)).toBeNull();
  });

  it("shows the error message when saving fails", async () => {
    saveOhmFileMock.mockRejectedValue(new Error("Could not save x.ohm: forbidden path"));
    render(<ValidateDock />);
    fireEvent.click(exportButton());
    await screen.findByText("Could not save x.ohm: forbidden path");
    expect((exportButton() as HTMLButtonElement).disabled).toBe(false);
  });

  it("disables Export while the Save dialog is open so it cannot be double-fired", async () => {
    let finish!: (value: unknown) => void;
    saveOhmFileMock.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    render(<ValidateDock />);
    fireEvent.click(exportButton());
    await waitFor(() => expect((exportButton() as HTMLButtonElement).disabled).toBe(true));
    finish({ status: "cancelled" });
    await waitFor(() => expect((exportButton() as HTMLButtonElement).disabled).toBe(false));
  });
});
