import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useCanvasStore } from "@/store/canvasStore";
import { useHarnessSessionStore } from "@/store/harnessSessionStore";
import fixture from "@/lib/fixtures/ohm-roundtrip.json";

const saveOhmFileMock = vi.fn();
vi.mock("@/lib/ohmFile", async (original) => ({
  ...(await original<typeof import("@/lib/ohmFile")>()),
  saveOhmFile: (...args: unknown[]) => saveOhmFileMock(...args),
}));
// Importing a plain graph saves it straight away; keep that off the network.
vi.mock("@/lib/api", () => ({
  api: {
    harnesses: {
      list: vi.fn().mockResolvedValue([]),
      get: vi.fn(),
      create: vi.fn().mockResolvedValue({ id: "new", name: "x" }),
      update: vi.fn(),
      delete: vi.fn(),
    },
  },
}));
const saveHarnessNowMock = vi.fn();
vi.mock("@/lib/studioDocuments", async (original) => ({
  ...(await original<typeof import("@/lib/studioDocuments")>()),
  saveHarnessNow: (...args: unknown[]) => saveHarnessNowMock(...args),
}));

import { exportOhm, importFile, pickAndImport, saveNow, useStudioFileStore } from "./studioFileActions";

const json = (body: unknown) => new Response(JSON.stringify(body));
const file = (text: string, name = "x.ohm") => new File([text], name);
const notice = () => useStudioFileStore.getState().notice;

beforeEach(() => {
  saveOhmFileMock.mockReset();
  saveHarnessNowMock.mockReset().mockResolvedValue(undefined);
  useStudioFileStore.setState({ notice: null, busy: false });
  useCanvasStore.setState({ isRunning: false, nodes: [], edges: [], harnessMeta: { id: null, name: "Untitled", description: "" } });
  useHarnessSessionStore.setState({ activeBundle: structuredClone(fixture) });
  vi.stubGlobal("fetch", vi.fn(async () => json({ ok: true, errors: [] })));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("saveNow", () => {
  it("runs the explicit save without a second 'Saved' (the header's save state says it); a failure is an error notice, not a throw", async () => {
    await saveNow();
    expect(saveHarnessNowMock).toHaveBeenCalledTimes(1);
    expect(notice()).toBeNull();
    saveHarnessNowMock.mockRejectedValue(new Error("Stop the current run first."));
    await saveNow();
    expect(notice()).toMatchObject({ tone: "error", text: "Stop the current run first." });
  });
});

describe("exportOhm (the one export, via the native Save dialog)", () => {
  it("hands the composed bundle to saveOhmFile and names the saved file", async () => {
    saveOhmFileMock.mockResolvedValue({ status: "saved", native: true, path: "D:/x/chosen.ohm", name: "chosen.ohm" });
    await exportOhm();
    expect(saveOhmFileMock).toHaveBeenCalledTimes(1);
    expect(saveOhmFileMock.mock.calls[0][0]).toMatchObject({ manifest: { id: "roundtrip-test" } });
    expect(notice()).toMatchObject({ tone: "ok", text: "Saved to chosen.ohm" });
  });

  it("keeps the browser wording when the fallback download ran", async () => {
    saveOhmFileMock.mockResolvedValue({ status: "saved", native: false, name: "h.ohm" });
    await exportOhm();
    expect(notice()?.text).toBe("Downloaded .ohm");
  });

  it("says nothing when the dialog is cancelled, and is free again afterwards", async () => {
    saveOhmFileMock.mockResolvedValue({ status: "cancelled" });
    await exportOhm();
    expect(notice()).toBeNull();
    expect(useStudioFileStore.getState().busy).toBe(false);
  });

  it("reports the error when saving fails", async () => {
    saveOhmFileMock.mockRejectedValue(new Error("Could not save x.ohm: forbidden path"));
    await exportOhm();
    expect(notice()).toMatchObject({ tone: "error", text: "Could not save x.ohm: forbidden path" });
    expect(useStudioFileStore.getState().busy).toBe(false);
  });

  it("cannot be double-fired while the Save dialog is open", async () => {
    let finish!: (value: unknown) => void;
    saveOhmFileMock.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const first = exportOhm();
    expect(useStudioFileStore.getState().busy).toBe(true);
    await exportOhm();
    expect(saveOhmFileMock).toHaveBeenCalledTimes(1);
    finish({ status: "cancelled" });
    await first;
    expect(useStudioFileStore.getState().busy).toBe(false);
  });
});

describe("importFile (the one import)", () => {
  it("loads a legacy role/label bundle into the canvas", async () => {
    const bundle = {
      schemaVersion: "1.0.0",
      manifest: { id: "legacy", name: "Legacy", description: "Imported" },
      graph: { nodes: [{ id: "po", role: "product-owner", label: "PO" }], edges: [] },
    };
    await importFile(file(JSON.stringify(bundle), "legacy.ohm"));
    expect(notice()).toMatchObject({ tone: "ok", text: "Imported Legacy. Save to keep it." });
    expect(useCanvasStore.getState().nodes).toMatchObject([{ id: "po", type: "agent", data: { label: "PO", roleId: "product-owner" } }]);
    expect(useCanvasStore.getState().harnessMeta.name).toBe("Legacy");
  });

  it("leaves the current graph and bundle intact when validation rejects the file", async () => {
    vi.mocked(fetch).mockResolvedValue(json({ ok: false, errors: ["Invalid graph"] }));
    const nodes = [{ id: "kept", type: "agent" as const, position: { x: 1, y: 2 }, data: { label: "Kept" } }];
    useCanvasStore.setState({ nodes });
    const before = useHarnessSessionStore.getState().activeBundle;
    await importFile(file("{}", "bad.ohm"));
    expect(notice()).toMatchObject({ tone: "error", text: "Invalid graph" });
    expect(useCanvasStore.getState().nodes).toEqual(nodes);
    expect(useHarnessSessionStore.getState().activeBundle).toBe(before);
  });

  it("refuses to replace a running graph, without asking the engine", async () => {
    useCanvasStore.setState({ isRunning: true });
    const nodes = useCanvasStore.getState().nodes;
    await importFile(file(JSON.stringify(fixture), "fixture.ohm"));
    expect(fetch).not.toHaveBeenCalled();
    expect(useCanvasStore.getState().nodes).toBe(nodes);
    expect(notice()).toMatchObject({ tone: "error", text: "Stop the current run first." });
  });

  it("still opens a plain graph JSON (the retired advanced format) as a new harness", async () => {
    const graph = { nodes: [{ id: "a", type: "agent", position: { x: 0, y: 0 }, data: { label: "A" } }], edges: [] };
    await importFile(file(JSON.stringify(graph), "Team flow.harness.json"));
    expect(useCanvasStore.getState().nodes.map((n) => n.id)).toEqual(["a"]);
    expect(useCanvasStore.getState().harnessMeta.name).toBe("Team flow");
    expect(notice()?.tone).toBe("ok");
  });

  it("explains a file that is neither", async () => {
    await importFile(file("{nope", "junk.ohm"));
    expect(notice()).toMatchObject({ tone: "error" });
    expect(notice()?.text).toMatch(/\.ohm/);
  });

  it("round-trips the complete authored fixture through export and import", async () => {
    const downloads: Blob[] = [];
    vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => {
      downloads.push(blob as Blob);
      return "blob:roundtrip-test";
    });
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    const real = await vi.importActual<typeof import("@/lib/ohmFile")>("@/lib/ohmFile");
    saveOhmFileMock.mockImplementation((bundle) => real.saveOhmFile(bundle));
    for (let cycle = 0; cycle < 2; cycle++) {
      const source = cycle === 0 ? JSON.stringify(fixture) : await downloads[0].text();
      await importFile(file(source, `cycle-${cycle}.ohm`));
      expect(notice()?.text).toMatch(/^Imported /);
      await exportOhm();
      expect(JSON.parse(await downloads[cycle].text())).toEqual(fixture);
    }
    expect(downloads).toHaveLength(2);
  });
});

describe("pickAndImport", () => {
  it("opens a file chooser limited to harness files and imports the chosen one", async () => {
    let accept = "";
    vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(function (this: HTMLInputElement) {
      accept = this.accept;
      Object.defineProperty(this, "files", { value: [file(JSON.stringify(fixture), "f.ohm")] });
      this.dispatchEvent(new Event("change"));
    });
    await pickAndImport();
    expect(accept).toContain(".ohm");
    expect(notice()?.text).toMatch(/^Imported /);
  });
});

describe("notices", () => {
  it("clear themselves when they are good news and stay when they are not", () => {
    vi.useFakeTimers();
    try {
      useStudioFileStore.getState().notify("ok", "Saved");
      vi.advanceTimersByTime(6100);
      expect(notice()).toBeNull();
      useStudioFileStore.getState().notify("error", "Nope");
      vi.advanceTimersByTime(60000);
      expect(notice()?.text).toBe("Nope");
      useStudioFileStore.getState().dismiss();
      expect(notice()).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
