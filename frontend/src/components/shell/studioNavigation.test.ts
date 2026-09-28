import { beforeEach, expect, it } from "vitest";
import { useShellStore } from "./shellStore";
import { useCanvasStore } from "@/store/canvasStore";

beforeEach(() => localStorage.clear());

it("returns to the Studio overview and resumes the editor without replacing the draft", () => {
  const node = { id: "draft", type: "agent" as const, position: { x: 47, y: 91 }, data: { label: "Draft", providerIds: ["pinned"] } };
  useCanvasStore.setState({ nodes: [node], edges: [], harnessMeta: { id: "draft", name: "My harness", description: "In progress" } });
  const shell = useShellStore.getState();
  shell.setStudioView("editor");
  shell.setStudioView("overview");
  expect(useShellStore.getState().studioView).toBe("overview");
  expect(useShellStore.getState().studioHasDraft).toBe(true);
  shell.setStudioView("editor");
  expect(useShellStore.getState().studioView).toBe("editor");
  expect(useCanvasStore.getState().nodes).toEqual([node]);
  expect(useCanvasStore.getState().harnessMeta.name).toBe("My harness");
});
