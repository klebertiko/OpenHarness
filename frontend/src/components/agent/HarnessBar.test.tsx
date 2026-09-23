import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { useShellStore } from "@/components/shell/shellStore";
import { useCanvasStore } from "@/store/canvasStore";
import { useHarnessSessionStore } from "@/store/harnessSessionStore";

import { HarnessBar } from "./HarnessBar";

vi.mock("./HarnessSwitch", () => ({
  HarnessSwitch: (p: { onOpenStudio?: () => void; onOpenProviders?: () => void }) => (
    <div data-testid="harness-switch-stub">
      <button type="button" onClick={p.onOpenStudio}>
        stub studio
      </button>
      <button type="button" onClick={p.onOpenProviders}>
        stub providers
      </button>
    </div>
  ),
}));

describe("HarnessBar", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    useShellStore.setState({ section: "chats", studioView: "overview" });
  });

  it("is just the harness picker: no loose Studio or Providers buttons", () => {
    render(<HarnessBar />);
    const bar = screen.getByTestId("harness-bar");
    expect(within(bar).getByTestId("harness-switch-stub")).toBeTruthy();
    expect(within(bar).queryByRole("button", { name: /^studio$/i })).toBeNull();
    expect(within(bar).queryByTitle("Open Providers")).toBeNull();
  });

  it("Edit in Studio from the picker switches to Studio", async () => {
    const user = userEvent.setup();
    render(<HarnessBar />);
    await user.click(screen.getByRole("button", { name: "stub studio" }));
    expect(useShellStore.getState().section).toBe("studio");
    expect(useShellStore.getState().studioView).toBe("editor");
  });

  it("Edit in Studio loads the active bundle's graph onto the canvas, not just the section", async () => {
    useHarnessSessionStore.setState({
      activeBundle: {
        manifest: { id: "test.bundle" },
        graph: {
          nodes: [{ id: "PO", role: "PO", label: "PO" }],
          edges: [],
        },
      },
    });
    useCanvasStore.setState({ nodes: [], edges: [] });

    const user = userEvent.setup();
    render(<HarnessBar />);
    await user.click(screen.getByRole("button", { name: "stub studio" }));

    expect(useCanvasStore.getState().nodes).toHaveLength(1);
    expect(useCanvasStore.getState().nodes[0].id).toBe("PO");
  });

  it("Providers from the picker opens the Providers section", async () => {
    const user = userEvent.setup();
    render(<HarnessBar />);
    await user.click(screen.getByRole("button", { name: "stub providers" }));
    expect(useShellStore.getState().section).toBe("providers");
  });

  it("opens the authored graph and its metadata without execution-only defaults", async () => {
    const node = { id: "writer", type: "agent", position: { x: 15, y: -20 }, data: { label: "Writer", custom: { policy: "review" } } };
    useCanvasStore.setState({ harnessMeta: { id: null, name: "Previous", description: "Previous" } });
    useHarnessSessionStore.setState({ activeBundle: {
      manifest: { id: "authored", name: "Authored", description: "Authoring description" },
      graph: { nodes: [node], edges: [] },
    } });
    render(<HarnessBar />);
    await userEvent.setup().click(screen.getByRole("button", { name: "stub studio" }));
    expect(useCanvasStore.getState().nodes).toEqual([node]);
    expect(useCanvasStore.getState().harnessMeta).toEqual({ id: "authored", name: "Authored", description: "Authoring description" });
  });
});
