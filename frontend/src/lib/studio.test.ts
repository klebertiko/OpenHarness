import { beforeEach, expect, it, vi } from "vitest";
import fixture from "./fixtures/ohm-roundtrip.json";
import { useCanvasStore } from "@/store/canvasStore";
import { useHarnessSessionStore, type HarnessBundle } from "@/store/harnessSessionStore";
import { useShellStore } from "@/components/shell/shellStore";
import { HARNESS_PRESETS } from "./templates";
import { fetchDefault, type OHarnessBundle } from "./bundlesApi";
import * as studio from "./studio";

vi.mock("./bundlesApi", async (original) => ({
  ...await original<typeof import("./bundlesApi")>(),
  fetchDefault: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  useCanvasStore.setState({ isRunning: false, nodes: [], edges: [], harnessMeta: { id: null, name: "Existing draft", description: "" } });
  useShellStore.setState({ studioView: "overview", studioHasDraft: false });
});

it("opens the returned framework bundle with its authored graph and content", async () => {
  const bundle = structuredClone(fixture) as unknown as OHarnessBundle;
  vi.mocked(fetchDefault).mockResolvedValue(bundle);
  await studio.openBundledHarness();
  expect(fetchDefault).toHaveBeenCalledOnce();
  expect(useHarnessSessionStore.getState().activeBundle).toEqual(bundle);
  expect(useCanvasStore.getState().nodes[0].position).toEqual((bundle.graph.nodes[0] as { position: unknown }).position);
  expect(useCanvasStore.getState().harnessMeta.name).toBe(bundle.manifest.name);
  expect(useShellStore.getState().studioView).toBe("editor");
  expect(useShellStore.getState().section).toBe("studio");
});

it("keeps the current draft when loading the bundled harness fails", async () => {
  const previous = useCanvasStore.getState();
  const activeBundle = useHarnessSessionStore.getState().activeBundle;
  vi.mocked(fetchDefault).mockRejectedValue(new Error("offline"));
  await expect(studio.openBundledHarness()).rejects.toThrow("offline");
  expect(useCanvasStore.getState()).toBe(previous);
  expect(useHarnessSessionStore.getState().activeBundle).toBe(activeBundle);
  expect(useShellStore.getState().studioView).toBe("overview");
});

it("opens a local sample without inheriting a previously opened framework's content", () => {
  useHarnessSessionStore.setState({ activeBundle: structuredClone(fixture) as unknown as HarnessBundle });
  const sample = HARNESS_PRESETS.find((preset) => preset.id === "minimal-gate")!;
  studio.openStudioPreset(sample);
  const bundle = useHarnessSessionStore.getState().activeBundle!;
  expect(bundle.content!.agents).toEqual({});
  expect(bundle.content!.skills).toEqual({});
  expect(bundle.content!.prompts).toEqual({});
  expect(bundle).not.toHaveProperty("extension");
  expect(bundle.graph!.nodes).toHaveLength(3);
  expect(useCanvasStore.getState().nodes).toEqual(sample.graph.nodes);
  expect(useCanvasStore.getState().nodes).not.toBe(sample.graph.nodes);
  expect(useCanvasStore.getState().harnessMeta.id).toBeNull();
  expect(useShellStore.getState().studioView).toBe("editor");
});

it("opens an empty editable harness with fresh content", () => {
  studio.newStudioHarness();
  expect(useCanvasStore.getState().nodes).toEqual([]);
  expect(useCanvasStore.getState().harnessMeta.name).toBe("Untitled harness");
  expect(useHarnessSessionStore.getState().activeBundle!.content!.agents).toEqual({});
  expect(useShellStore.getState().studioHasDraft).toBe(true);
  expect(useShellStore.getState().studioView).toBe("editor");
});

it("applies the edited draft to chat with independent pins and original content", () => {
  useHarnessSessionStore.setState({ activeBundle: structuredClone(fixture) as unknown as HarnessBundle, enabled: false });
  const nodes = [
    { id: "author", type: "agent" as const, position: { x: 10, y: 20 }, data: { label: "Author", providerIds: ["anthropic"] } },
    { id: "reviewer", type: "agent" as const, position: { x: 200, y: 20 }, data: { label: "Reviewer", providerIds: ["openai"] } },
  ];
  useCanvasStore.setState({ nodes, edges: [], harnessMeta: { id: null, name: "My edited harness", description: "Edited" } });
  studio.useStudioInChat();
  const applied = useHarnessSessionStore.getState().activeBundle!;
  expect(applied.manifest.name).toBe("My edited harness");
  expect(applied.graph!.nodes.map((n) => (n as { data: { providerIds: string[] } }).data.providerIds)).toEqual([["anthropic"], ["openai"]]);
  expect(applied.content).toEqual(fixture.content);
  expect(useHarnessSessionStore.getState().enabled).toBe(true);
  expect(useShellStore.getState().section).toBe("chats");
  expect(useCanvasStore.getState().nodes).toEqual(nodes);
});
it("does not reopen Studio after the initiating view was left", async () => {
  vi.mocked(fetchDefault).mockResolvedValue(structuredClone(fixture) as unknown as OHarnessBundle);
  const controller = new AbortController();
  const before = useCanvasStore.getState();
  const opening = studio.openBundledHarness(controller.signal);
  controller.abort();
  await opening;
  expect(useCanvasStore.getState()).toBe(before);
  expect(useShellStore.getState().studioView).toBe("overview");
});
it("rejects a malformed graph before replacing the draft or its content", () => {
  const before = useCanvasStore.getState();
  const active = useHarnessSessionStore.getState().activeBundle;
  expect(() => studio.openStudioBundle({ manifest: { id: "bad" }, graph: { nodes: null, edges: [] } } as unknown as HarnessBundle)).toThrow("editable graph");
  expect(useCanvasStore.getState()).toBe(before);
  expect(useHarnessSessionStore.getState().activeBundle).toBe(active);
});
