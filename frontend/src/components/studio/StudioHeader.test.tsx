import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ReactFlowProvider } from "@xyflow/react";
import { useCanvasStore } from "@/store/canvasStore";
import { useCopilotStore } from "@/store/copilotStore";
import { useHarnessSessionStore } from "@/store/harnessSessionStore";
import { useShellStore } from "@/components/shell/shellStore";
import * as docs from "@/lib/studioDocuments";
import * as studio from "@/lib/studio";
import * as files from "@/lib/studioFileActions";
import { useReadinessStore } from "./readinessStore";
import { useStudioHeaderStore } from "./studioHeaderStore";
import { StudioHeader } from "./StudioHeader";

vi.mock("@/lib/studioDocuments", async (original) => ({
  ...(await original<typeof import("@/lib/studioDocuments")>()),
  saveHarnessAs: vi.fn().mockResolvedValue(undefined),
  discardStudioChanges: vi.fn().mockResolvedValue(undefined),
  removeSavedHarness: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/studio", async (original) => ({
  ...(await original<typeof import("@/lib/studio")>()),
  openStudioExample: vi.fn(),
  newStudioHarness: vi.fn(),
  useStudioInChat: vi.fn(),
}));
vi.mock("@/lib/studioFileActions", async (original) => ({
  ...(await original<typeof import("@/lib/studioFileActions")>()),
  saveNow: vi.fn().mockResolvedValue(undefined),
  exportOhm: vi.fn().mockResolvedValue(undefined),
  pickAndImport: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/studioExamples", async (original) => ({
  ...(await original<typeof import("@/lib/studioExamples")>()),
  fetchStudioExamples: vi.fn().mockResolvedValue([
    { id: "openharness.default.agile", name: "OpenHarness Agile", description: "", bundle: { manifest: { id: "openharness.default.agile" } } },
    { id: "sample:minimal-gate", name: "Sample: Agent + review", description: "", bundle: null, presetId: "minimal-gate" },
    { id: "openharness.example.deepseek-harness", name: "DeepSeek Harness", description: "", bundle: { manifest: { id: "openharness.example.deepseek-harness" } } },
  ]),
}));
const actionsMock = { run: vi.fn(), stop: vi.fn(), resolveHitl: vi.fn() };
vi.mock("@/lib/actions", async (original) => ({
  ...(await original<typeof import("@/lib/actions")>()),
  useHarnessActions: () => actionsMock,
}));
// The check itself is covered in readinessStore.test; here the pill just shows the store's summary.
vi.mock("./readinessStore", async (original) => {
  const real = await original<typeof import("./readinessStore")>();
  return { ...real, useReadinessCheck: () => real.useReadinessStore((s) => s.summary) };
});

const node = { id: "a", type: "agent" as const, position: { x: 0, y: 0 }, data: { label: "a" } };
const ready = { state: "ready" as const, label: "Ready to run", problems: [], blocking: false };
const setDraft = (id: string | null, bundleId = "openharness.studio.export") => {
  useCanvasStore.setState({ isRunning: false, nodes: [node], edges: [], executionMode: "mock", harnessMeta: { id, name: "My harness", description: "" } });
  useHarnessSessionStore.setState({ activeBundle: { manifest: { id: bundleId } } });
};
const renderHeader = () => render(<ReactFlowProvider><StudioHeader /></ReactFlowProvider>);
const openFile = async () => userEvent.click(screen.getByRole("button", { name: "File" }));

beforeEach(() => {
  vi.clearAllMocks();
  useShellStore.setState({ section: "studio", studioView: "editor" });
  docs.useStudioDocsStore.setState({ saveState: "idle", dirty: false });
  useReadinessStore.setState({ summary: ready, panel: null });
  useStudioHeaderStore.setState({ pending: null });
  files.useStudioFileStore.setState({ notice: null, busy: false });
  useCopilotStore.setState({ open: false });
});
afterEach(cleanup);

describe("who this harness is", () => {
  it("names the harness once, in an editable field, and says where it came from and whether it is saved", () => {
    setDraft(null, "openharness.example.deepseek-harness");
    renderHeader();
    expect(screen.getAllByDisplayValue("My harness")).toHaveLength(1);
    expect(screen.queryAllByText("My harness")).toHaveLength(0);
    expect(screen.getByText("Example")).toBeTruthy();
    expect(screen.getByText("Not saved yet")).toBeTruthy();
    cleanup();
    setDraft("h1");
    docs.useStudioDocsStore.setState({ dirty: true });
    renderHeader();
    expect(screen.getByText("Saved harness")).toBeTruthy();
    expect(screen.getByText("Unsaved changes")).toBeTruthy();
  });

  it("renames the harness from that one field", async () => {
    setDraft("h1");
    renderHeader();
    const input = screen.getByRole("textbox", { name: "Harness name" });
    await userEvent.clear(input);
    await userEvent.type(input, "Research");
    expect(useCanvasStore.getState().harnessMeta.name).toBe("Research");
  });

  it("goes back to the Studio library", async () => {
    setDraft("h1");
    renderHeader();
    await userEvent.click(screen.getByRole("button", { name: "Back to Studio" }));
    expect(useShellStore.getState().studioView).toBe("overview");
  });
});

describe("the File menu is the one home for document actions", () => {
  it("lists every action once, and Delete says Draft for an unsaved harness", async () => {
    setDraft(null);
    renderHeader();
    await openFile();
    for (const name of ["New", "Open example", "Import", "Export", "Save as…", "Discard", "Delete draft"]) {
      expect(screen.getAllByRole("menuitem", { name })).toHaveLength(1);
    }
  });

  it("locks the actions that would replace the canvas while a run is going", async () => {
    setDraft("h1");
    useCanvasStore.setState({ isRunning: true });
    renderHeader();
    await openFile();
    for (const name of ["New", "Open example", "Import", "Save as…", "Discard", "Delete"]) {
      expect((screen.getByRole("menuitem", { name }) as HTMLButtonElement).disabled).toBe(true);
    }
  });

  it("New, Import and Export call the shared file actions", async () => {
    setDraft("h1");
    renderHeader();
    await openFile();
    await userEvent.click(screen.getByRole("menuitem", { name: "New" }));
    expect(studio.newStudioHarness).toHaveBeenCalled();
    await openFile();
    await userEvent.click(screen.getByRole("menuitem", { name: "Import" }));
    expect(files.pickAndImport).toHaveBeenCalled();
    await openFile();
    await userEvent.click(screen.getByRole("menuitem", { name: "Export" }));
    expect(files.exportOhm).toHaveBeenCalled();
  });

  it("lists every example the catalog returns and opens the chosen one as a copy", async () => {
    setDraft("h1");
    renderHeader();
    await openFile();
    await userEvent.click(screen.getByRole("menuitem", { name: "Open example" }));
    for (const n of ["OpenHarness Agile", "Sample: Agent + review", "DeepSeek Harness"]) {
      expect(await screen.findByRole("menuitem", { name: n })).toBeTruthy();
    }
    await userEvent.click(screen.getByRole("menuitem", { name: /DeepSeek Harness/ }));
    expect(studio.openStudioExample).toHaveBeenCalledWith(expect.objectContaining({ id: "openharness.example.deepseek-harness" }));
  });

  it("Save as asks for a name, then saves a copy under it", async () => {
    setDraft(null);
    renderHeader();
    await openFile();
    await userEvent.click(screen.getByRole("menuitem", { name: "Save as…" }));
    const input = screen.getByRole("textbox", { name: "Name of the copy" });
    await userEvent.clear(input);
    await userEvent.type(input, "Copy of it");
    await userEvent.click(screen.getByRole("button", { name: "Save copy" }));
    await waitFor(() => expect(docs.saveHarnessAs).toHaveBeenCalledWith("Copy of it"));
  });

  it("Discard and Delete ask for confirmation first, and Cancel does nothing", async () => {
    setDraft("h1");
    docs.useStudioDocsStore.setState({ dirty: true });
    renderHeader();
    await openFile();
    await userEvent.click(screen.getByRole("menuitem", { name: "Discard" }));
    expect(docs.discardStudioChanges).not.toHaveBeenCalled();
    await userEvent.click(within(screen.getByRole("group", { name: "Confirm discard" })).getByRole("button", { name: "Cancel" }));
    expect(docs.discardStudioChanges).not.toHaveBeenCalled();

    await openFile();
    await userEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
    await userEvent.click(within(screen.getByRole("group", { name: "Confirm delete" })).getByRole("button", { name: "Cancel" }));
    expect(docs.removeSavedHarness).not.toHaveBeenCalled();

    await openFile();
    await userEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
    await userEvent.click(within(screen.getByRole("group", { name: "Confirm delete" })).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(docs.removeSavedHarness).toHaveBeenCalledWith("h1"));
  });

  it("deleting a draft discards it, and a bundled example offers no Delete", async () => {
    setDraft(null);
    renderHeader();
    await openFile();
    await userEvent.click(screen.getByRole("menuitem", { name: "Delete draft" }));
    await userEvent.click(within(screen.getByRole("group", { name: "Confirm delete" })).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(docs.discardStudioChanges).toHaveBeenCalled());
    cleanup();
    setDraft(null, "openharness.example.deepseek-harness");
    renderHeader();
    await openFile();
    expect(screen.queryByRole("menuitem", { name: /^Delete/ })).toBeNull();
  });

  it("opens its confirmations from the palette too, through the shared header store", async () => {
    setDraft("h1");
    renderHeader();
    act(() => useStudioHeaderStore.getState().setPending("saveas"));
    expect(screen.getByRole("textbox", { name: "Name of the copy" })).toBeTruthy();
  });
});

describe("Save", () => {
  it("saves now through the shared action, for a harness that has nothing on disk yet", async () => {
    setDraft(null);
    renderHeader();
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(files.saveNow).toHaveBeenCalled();
  });

  it("is idle, not hidden, when everything is already saved", () => {
    setDraft("h1");
    docs.useStudioDocsStore.setState({ saveState: "saved", dirty: false });
    renderHeader();
    expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getAllByText("Saved")).toHaveLength(1);
  });

  it("is available again when there are unsaved changes, or the engine could not save", () => {
    setDraft("h1");
    docs.useStudioDocsStore.setState({ saveState: "idle", dirty: true });
    renderHeader();
    expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(false);
    cleanup();
    docs.useStudioDocsStore.setState({ saveState: "error", dirty: false });
    renderHeader();
    expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByText("Not saved — engine unreachable")).toBeTruthy();
  });
});

describe("undo and redo", () => {
  it("follow the history and call the store", async () => {
    setDraft("h1");
    useCanvasStore.setState({ _history: [], _historyIndex: -1 } as never);
    const undo = vi.fn();
    const redo = vi.fn();
    useCanvasStore.setState({ undo, redo, canUndo: () => true, canRedo: () => false } as never);
    renderHeader();
    await userEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(undo).toHaveBeenCalled();
    expect((screen.getByRole("button", { name: "Redo" }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("Ask Nilo", () => {
  it("opens the assistant panel", async () => {
    setDraft("h1");
    renderHeader();
    await userEvent.click(screen.getByRole("button", { name: "Ask Nilo" }));
    expect(useCopilotStore.getState().open).toBe(true);
  });
});

describe("Run", () => {
  it("runs the harness, and is off when there is nothing to run", async () => {
    setDraft("h1");
    renderHeader();
    await userEvent.click(screen.getByRole("button", { name: "Run" }));
    expect(actionsMock.run).toHaveBeenCalled();
    cleanup();
    useCanvasStore.setState({ nodes: [] });
    renderHeader();
    expect((screen.getByRole("button", { name: "Run" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("turns into Stop while running, and locks the options", async () => {
    setDraft("h1");
    useCanvasStore.setState({ isRunning: true });
    renderHeader();
    expect(screen.queryByRole("button", { name: "Run" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Stop" }));
    expect(actionsMock.stop).toHaveBeenCalled();
    expect((screen.getByRole("button", { name: /Run options/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("offers only the two actual execution behaviours, with the legacy local alias shown as Connected", async () => {
    setDraft("h1");
    useCanvasStore.setState({ executionMode: "local" });
    renderHeader();
    await userEvent.click(screen.getByRole("button", { name: /Run options/ }));
    expect(screen.getAllByRole("menuitemradio")).toHaveLength(2);
    expect(screen.getByRole("menuitemradio", { name: /Connected/ }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("menuitemradio", { name: /Mock/ }).getAttribute("aria-checked")).toBe("false");
    expect(screen.queryByRole("menuitemradio", { name: "Local" })).toBeNull();
  });

  it("changes the mode from the menu, with the keyboard, and the button says which mode it will use", async () => {
    setDraft("h1");
    renderHeader();
    const trigger = screen.getByRole("button", { name: /Run options/ });
    expect(trigger.textContent).toContain("Mock");
    await userEvent.click(trigger);
    await userEvent.keyboard("{ArrowDown}{Enter}");
    expect(useCanvasStore.getState().executionMode).toBe("live");
    expect(screen.getByRole("button", { name: /Run options/ }).textContent).toContain("Connected");
  });

  it("holds Plan simulation and Run in chat", async () => {
    setDraft("h1");
    const plan = vi.fn().mockResolvedValue(undefined);
    useReadinessStore.setState({ runPlan: plan } as never);
    renderHeader();
    await userEvent.click(screen.getByRole("button", { name: /Run options/ }));
    await userEvent.click(screen.getByRole("menuitem", { name: /Plan simulation/ }));
    expect(plan).toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: /Run options/ }));
    await userEvent.click(screen.getByRole("menuitem", { name: /Run in chat/ }));
    expect(studio.useStudioInChat).toHaveBeenCalled();
  });

  it("cannot Run in chat or plan an empty harness", async () => {
    setDraft("h1");
    useCanvasStore.setState({ nodes: [] });
    renderHeader();
    await userEvent.click(screen.getByRole("button", { name: /Run options/ }));
    expect((screen.getByRole("menuitem", { name: /Plan simulation/ }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("menuitem", { name: /Run in chat/ }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("readiness", () => {
  const problem = { id: "b1", severity: "problem" as const, source: "bundle" as const, nodeId: "a", label: "Writer", note: "has no role" };
  const review = { id: "s1", severity: "review" as const, source: "structure" as const, nodeId: null, label: "Harness", note: "no agent or gate to start from" };

  it("shows the one verdict as a pill and opens the Problems panel from it", async () => {
    setDraft("h1");
    useReadinessStore.setState({ summary: { state: "problems", label: "1 problem", problems: [problem, review], blocking: true } });
    renderHeader();
    const pill = screen.getByRole("button", { name: /1 problem/ });
    expect(pill.getAttribute("aria-expanded")).toBe("false");
    await userEvent.click(pill);
    const panel = screen.getByRole("region", { name: "Problems" });
    expect(within(panel).getByText("has no role")).toBeTruthy();
    expect(within(panel).getByText("no agent or gate to start from")).toBeTruthy();
    await userEvent.click(within(panel).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("region", { name: "Problems" })).toBeNull();
  });

  it("selects the node a problem is about", async () => {
    setDraft("h1");
    useCanvasStore.setState({ selectedNodeId: null });
    useReadinessStore.setState({ summary: { state: "problems", label: "1 problem", problems: [problem], blocking: true }, panel: "problems" });
    renderHeader();
    await userEvent.click(screen.getByRole("button", { name: /Writer/ }));
    expect(useCanvasStore.getState().selectedNodeId).toBe("a");
  });

  it("says Ready when it is, and has nothing to open for an empty harness", () => {
    setDraft("h1");
    renderHeader();
    expect(screen.getByRole("button", { name: /Ready to run/ })).toBeTruthy();
    cleanup();
    useCanvasStore.setState({ nodes: [] });
    useReadinessStore.setState({ summary: { state: "empty", label: "Nothing to check yet", problems: [], blocking: false } });
    renderHeader();
    expect((screen.getByRole("button", { name: /Nothing to check yet/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("Engine offline offers a retry through the same pill", async () => {
    setDraft("h1");
    useReadinessStore.setState({ summary: { state: "offline", label: "Engine offline", problems: [], blocking: false } });
    const recheck = vi.fn();
    useReadinessStore.setState({ recheck } as never);
    renderHeader();
    await userEvent.click(screen.getByRole("button", { name: /Engine offline/ }));
    expect(recheck).toHaveBeenCalled();
  });

  it("shows the simulation plan in the same place, and calls it stale once the harness changed", () => {
    setDraft("h1");
    useReadinessStore.setState({
      panel: "plan",
      plan: { status: "ok", message: "Simulation plan · 1 step · no provider called", errors: [], steps: [{ nodeId: "a", role: "a", status: "planned", note: "" }], forKey: "old" },
    });
    renderHeader();
    const panel = screen.getByRole("region", { name: "Simulation plan" });
    expect(within(panel).getByText(/no provider called/)).toBeTruthy();
    expect(within(panel).getByText(/planned/)).toBeTruthy();
  });
});

describe("notices", () => {
  it("reports how a file action went, and can be dismissed", async () => {
    setDraft("h1");
    files.useStudioFileStore.setState({ notice: { id: 1, tone: "error", text: "Could not save x.ohm: forbidden path" } });
    renderHeader();
    expect(screen.getByRole("alert").textContent).toContain("Could not save x.ohm: forbidden path");
    await userEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
