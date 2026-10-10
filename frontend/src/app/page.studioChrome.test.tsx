/**
 * The Studio editor screen as a whole: every action has exactly ONE home and no
 * dead or duplicate chrome is left behind. This pins the contract from the
 * redesign audit (docs/design/studio-redesign, slice S2 "one header").
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useCanvasStore } from "@/store/canvasStore";
import { useShellStore } from "@/components/shell/shellStore";
import { useHarnessSessionStore } from "@/store/harnessSessionStore";
import { markClean, useStudioDocsStore } from "@/lib/studioDocuments";

// The React Flow surface is a rendering concern, not part of the chrome contract.
vi.mock("@/components/canvas/HarnessCanvas", () => ({
  HarnessCanvas: () => <div data-testid="canvas" />,
}));

import Home from "./page";

const nodes = [
  { id: "a", type: "agent" as const, position: { x: 0, y: 0 }, data: { label: "Writer" } },
  { id: "b", type: "hitl" as const, position: { x: 260, y: 0 }, data: { label: "Review" } },
];

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ status: "ok", ok: true, errors: [], items: [] }))));
  window.localStorage.clear();
  window.localStorage.setItem("oh.shell.v8", JSON.stringify({ section: "studio" }));
  useShellStore.setState({ section: "studio", studioView: "editor", hydrated: true });
  useCanvasStore.setState({
    isRunning: false,
    nodes,
    edges: [{ id: "e", source: "a", sourceHandle: "out", target: "b", targetHandle: "in" }],
    selectedNodeId: null,
    harnessMeta: { id: null, name: "My harness", description: "" },
  });
  useHarnessSessionStore.setState({ activeBundle: { manifest: { id: "openharness.studio.export" } } });
  useStudioDocsStore.setState({ saveState: "idle", dirty: false });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const count = (name: RegExp | string, roles = ["button", "menuitem"]) =>
  roles.flatMap((role) => screen.queryAllByRole(role as "button", { name })).length;

describe("Studio editor chrome", () => {
  it("shows the harness name exactly once", () => {
    render(<Home />);
    const asInput = screen.queryAllByDisplayValue("My harness").length;
    const asText = screen.queryAllByText("My harness").length;
    expect(asInput + asText).toBe(1);
  });

  it("has one home for each document action, reachable from the File menu", async () => {
    render(<Home />);
    await userEvent.click(screen.getByRole("button", { name: "File" }));
    expect(count(/^save$|^save harness$/i)).toBe(1);
    expect(count(/save as/i)).toBe(1);
    expect(count(/export/i)).toBe(1);
    expect(count(/import/i)).toBe(1);
    expect(count(/^new\b/i)).toBe(1);
    expect(count(/open example/i)).toBe(1);
    expect(count(/discard/i)).toBe(1);
  });

  it("has one Run control and one place to choose how it runs", async () => {
    render(<Home />);
    expect(screen.getAllByRole("button", { name: "Run" })).toHaveLength(1);
    expect(screen.queryAllByRole("menuitemradio")).toHaveLength(0);
    await userEvent.click(screen.getByRole("button", { name: /^Run options/ }));
    expect(screen.getAllByRole("menuitemradio", { name: /^Mock/ })).toHaveLength(1);
    expect(screen.getAllByRole("menuitemradio", { name: /^Connected/ })).toHaveLength(1);
  });

  it("keeps Plan simulation and Run in chat in the Run menu, not in a separate dock", async () => {
    render(<Home />);
    expect(screen.queryByText("BUNDLE")).toBeNull();
    expect(screen.queryByRole("button", { name: "Plan simulation" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Validate" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: /^Run options/ }));
    expect(screen.getAllByRole("menuitem", { name: /Plan simulation/ })).toHaveLength(1);
    expect(screen.getAllByRole("menuitem", { name: /Run in chat/ })).toHaveLength(1);
  });

  it("has no machine status bar in the editor and no second 'Saved' label", () => {
    render(<Home />);
    expect(screen.queryByRole("contentinfo")).toBeNull();
    expect(screen.queryByText(/exec mock|section studio|graph \d+n/)).toBeNull();
    useCanvasStore.setState({ harnessMeta: { id: "h1", name: "My harness", description: "" } });
    markClean(); // what is on screen is what is on disk
    cleanup();
    render(<Home />);
    expect(screen.getAllByText("Saved")).toHaveLength(1);
  });

  it("keeps the window title bar to window chrome: brand, section and search", () => {
    render(<Home />);
    const bar = screen.getAllByRole("banner")[0];
    expect(within(bar).queryByRole("textbox")).toBeNull();
    expect(within(bar).getByRole("button", { name: "Search and commands" })).toBeTruthy();
  });
});
