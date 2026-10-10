import { beforeEach, expect, it } from "vitest";
import { useThreadStore } from "./threadStore";
import { usePermissionStore } from "./permissionStore";

beforeEach(() => {
  localStorage.clear();
  useThreadStore.setState({ threads: [], activeThreadId: null, messagesByThread: {} });
  usePermissionStore.setState({ byThread: {}, draft: "ask" });
});

it("deleting a conversation forgets its permission mode, and only its own", () => {
  const a = useThreadStore.getState().createThread("a");
  const b = useThreadStore.getState().createThread("b");
  usePermissionStore.getState().setMode(a, "auto_workspace");
  usePermissionStore.getState().setMode(b, "plan");
  useThreadStore.getState().deleteThread(a);
  expect(usePermissionStore.getState().byThread).toEqual({ [b]: "plan" });
});
