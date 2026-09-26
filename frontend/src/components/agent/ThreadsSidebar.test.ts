import { beforeEach, describe, expect, it } from "vitest";

import { useThreadStore } from "@/store/threadStore";

/**
 * Sidebar contract (no RTL): New chat / createThread must select the new thread.
 * Full DOM coverage waits on a later UI harness; store seam is the AC for Task 3.
 */
describe("ThreadsSidebar create → select contract", () => {
  beforeEach(async () => {
    localStorage.clear();
    useThreadStore.setState({ threads: [], activeThreadId: null });
    await useThreadStore.persist.clearStorage();
  });

  it("creating a thread selects it as active (New chat CTA)", () => {
    const id = useThreadStore.getState().createThread();
    expect(useThreadStore.getState().activeThreadId).toBe(id);
    expect(useThreadStore.getState().threads[0]?.id).toBe(id);
  });

  it("↑/↓ selection order follows newest-first list", () => {
    const older = useThreadStore.getState().createThread("Older");
    const newer = useThreadStore.getState().createThread("Newer");
    expect(useThreadStore.getState().threads.map((t) => t.id)).toEqual([newer, older]);

    useThreadStore.getState().selectThread(newer);
    useThreadStore.getState().selectThread(older);
    expect(useThreadStore.getState().activeThreadId).toBe(older);
  });
});
