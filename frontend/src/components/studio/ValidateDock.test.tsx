import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ValidateDock } from "./ValidateDock";
import { useCanvasStore } from "@/store/canvasStore";
import { useHarnessSessionStore } from "@/store/harnessSessionStore";
import fixture from "@/lib/fixtures/ohm-roundtrip.json";

describe("Studio OHM import", () => {
  beforeEach(() => {
    useCanvasStore.setState({ isRunning: false, nodes: [], edges: [], harnessMeta: { id: null, name: "Untitled", description: "" } });
    useHarnessSessionStore.setState({ activeBundle: null });
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => new Response(JSON.stringify({ ok: true, errors: [] }))));
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it("loads legacy role/label bundles into the canvas instead of reporting success with a stale graph", async () => {
    const bundle = { schemaVersion: "1.0.0", manifest: { id: "legacy", name: "Legacy", description: "Imported" },
      graph: { nodes: [{ id: "po", role: "product-owner", label: "PO" }], edges: [] } };
    const { container } = render(<ValidateDock />);
    fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [new File([JSON.stringify(bundle)], "legacy.ohm")] } });
    await screen.findByText("Imported · legacy");
    expect(useCanvasStore.getState().nodes).toMatchObject([{ id: "po", type: "agent", data: { label: "PO", roleId: "product-owner" } }]);
    expect(useCanvasStore.getState().harnessMeta.name).toBe("Legacy");
  });

  it("leaves the current graph and bundle intact when validation rejects a file", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ ok: false, errors: ["Invalid graph"] })));
    const nodes = [{ id: "kept", type: "agent" as const, position: { x: 1, y: 2 }, data: { label: "Kept" } }];
    useCanvasStore.setState({ nodes });
    const { container } = render(<ValidateDock />);
    fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [new File(['{}'], "bad.ohm")] } });
    await waitFor(() => expect(screen.getByText("Import failed validation")).toBeTruthy());
    expect(useCanvasStore.getState().nodes).toEqual(nodes);
    expect(useHarnessSessionStore.getState().activeBundle).toBeNull();
  });

  it("exports and reimports the complete authored fixture through actual file and download boundaries", async () => {
    const downloads: Blob[] = [];
    vi.spyOn(URL, "createObjectURL").mockImplementation(blob => {
      downloads.push(blob as Blob);
      return "blob:roundtrip-test";
    });
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    const { container } = render(<ValidateDock />);
    const input = container.querySelector('input[type="file"]')!;
    for (let cycle = 0; cycle < 2; cycle++) {
      const source = cycle === 0 ? JSON.stringify(fixture) : await downloads[0].text();
      fireEvent.change(input, { target: { files: [new File([source], `cycle-${cycle}.ohm`)] } });
      await screen.findByText("Imported · roundtrip-test");
      fireEvent.click(screen.getByRole("button", { name: "Export .ohm" }));
      await screen.findByText("Downloaded .ohm");
      expect(JSON.parse(await downloads[cycle].text())).toEqual(fixture);
    }
    expect(downloads).toHaveLength(2);
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2);
  });
});

 it("invalidates a validation result when the authored graph changes", async () => {
  useHarnessSessionStore.setState({ activeBundle: structuredClone(fixture) });
  useCanvasStore.setState({ isRunning: false, nodes: [], edges: [] });
  render(<ValidateDock />);
  fireEvent.click(screen.getByRole("button", { name: "Validate" }));
  await screen.findByText("Bundle valid");
  act(() => useCanvasStore.getState().setEdges([{ id: "bad", source: "missing", target: "missing" }]));
  expect(screen.queryByText("Bundle valid")).toBeNull();
 });
 it("discards validation finishing after the graph was edited", async () => {
  useHarnessSessionStore.setState({ activeBundle: structuredClone(fixture) });
  useCanvasStore.setState({ isRunning: false });
  let done!: (response: Response) => void;
  vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(resolve => { done = resolve; })));
  render(<ValidateDock />); fireEvent.click(screen.getByRole("button", { name: "Validate" }));
  await waitFor(() => expect(done).toBeTypeOf("function"));
  act(() => useCanvasStore.getState().setHarnessMeta({ name: "Changed while validating" }));
  await act(async () => done(new Response(JSON.stringify({ ok: true, errors: [] }))));
  expect(screen.queryByText("Bundle valid")).toBeNull();
 });
 it("prevents import from replacing a running graph, including file-input events", async () => {
  useCanvasStore.setState({ isRunning: true });
  const nodes = useCanvasStore.getState().nodes;
  vi.stubGlobal("fetch", vi.fn());
  const { container } = render(<ValidateDock />);
  expect((screen.getByRole("button", { name: "Import .ohm" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [new File([JSON.stringify(fixture)], "fixture.ohm")] } });
  await act(async () => {});
  expect(fetch).not.toHaveBeenCalled(); expect(useCanvasStore.getState().nodes).toBe(nodes);
 });

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); useCanvasStore.setState({ isRunning: false }); });

beforeEach(() => { vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: true, errors: [] })))); useCanvasStore.setState({ isRunning: false }); });

it("an older validation cannot overwrite a newer result", async () => {
  useHarnessSessionStore.setState({ activeBundle: structuredClone(fixture) });
  let older!: (value: Response) => void;
  vi.mocked(fetch).mockImplementationOnce(() => new Promise<Response>(resolve => { older=resolve; }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ ok: false, errors: ["New graph rejected"] })));
  render(<ValidateDock />); fireEvent.click(screen.getByRole("button", { name: "Validate" }));
  await waitFor(() => expect(older).toBeTypeOf("function"));
  act(() => useCanvasStore.getState().setHarnessMeta({ name: "Newer graph" }));
  fireEvent.click(screen.getByRole("button", { name: "Validate" }));
  await screen.findByText("Validation failed");
  await act(async () => older(new Response(JSON.stringify({ ok: true, errors: [] }))));
  expect(screen.getByText("Validation failed")).toBeTruthy();
  expect(screen.queryByText("Bundle valid")).toBeNull();
});
