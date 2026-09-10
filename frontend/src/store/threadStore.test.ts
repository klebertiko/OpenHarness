import { beforeEach, describe, expect, it } from "vitest";

import { THREADS_STORAGE_KEY, useThreadStore } from "./threadStore";

describe("threadStore", () => {
  beforeEach(async () => {
    localStorage.clear();
    useThreadStore.setState({ threads: [], activeThreadId: null });
    await useThreadStore.persist.clearStorage();
  });

  it("create → select → rename updates threads and activeThreadId", () => {
    const firstId = useThreadStore.getState().createThread("Planning");
    expect(useThreadStore.getState().activeThreadId).toBe(firstId);

    const secondId = useThreadStore.getState().createThread("Debug session");
    expect(useThreadStore.getState().activeThreadId).toBe(secondId);
    expect(useThreadStore.getState().threads.map((t) => t.title)).toEqual([
      "Debug session",
      "Planning",
    ]);

    useThreadStore.getState().selectThread(firstId);
    expect(useThreadStore.getState().activeThreadId).toBe(firstId);

    useThreadStore.getState().renameThread(firstId, "Planning v2");
    const renamed = useThreadStore.getState().threads.find((t) => t.id === firstId);
    expect(renamed?.title).toBe("Planning v2");
    expect(renamed?.updatedAt).toBeGreaterThanOrEqual(renamed!.createdAt);
  });

  it("createThread without title uses a default label", () => {
    const id = useThreadStore.getState().createThread();
    const thread = useThreadStore.getState().threads.find((t) => t.id === id);
    expect(thread?.title).toBe("New thread");
  });

  it("persists threads and activeThreadId and rehydrates from localStorage", async () => {
    const id = useThreadStore.getState().createThread("Persist me");
    useThreadStore.getState().renameThread(id, "Persist me (renamed)");

    const raw = localStorage.getItem(THREADS_STORAGE_KEY);
    expect(raw).not.toBeNull();

    // setState writes through persist — restore the blob before rehydrate.
    useThreadStore.setState({ threads: [], activeThreadId: null });
    localStorage.setItem(THREADS_STORAGE_KEY, raw!);
    await useThreadStore.persist.rehydrate();

    const { threads, activeThreadId } = useThreadStore.getState();
    expect(activeThreadId).toBe(id);
    expect(threads).toHaveLength(1);
    expect(threads[0].title).toBe("Persist me (renamed)");
  });
});
