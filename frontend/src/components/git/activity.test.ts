import { describe, expect, it } from "vitest";

import { buildActivity } from "./activity";
import type { Comment, Commit, Review } from "@/lib/reposApi";

const commit: Commit = {
  sha: "abc1234",
  message: "feat: thing",
  author: "you",
  authoredAt: "2026-09-01T00:00:00Z",
};

const review: Review = {
  id: 1,
  author: "reviewer",
  authorAvatarUrl: "",
  state: "approved",
  submittedAt: "2026-09-02T00:00:00Z",
};

const comment: Comment = {
  id: 1,
  author: "you",
  authorAvatarUrl: "",
  body: "looks good",
  createdAt: "2026-09-03T00:00:00Z",
};

describe("buildActivity", () => {
  it("interleaves commits, reviews and comments in chronological order", () => {
    const items = buildActivity([commit], [review], [comment]);
    expect(items.map((i) => i.kind)).toEqual(["commit", "review", "comment"]);
  });

  it("sorts strictly by timestamp regardless of source array order", () => {
    const earlyComment: Comment = { ...comment, id: 2, createdAt: "2026-08-01T00:00:00Z" };
    const items = buildActivity([commit], [review], [comment, earlyComment]);
    const timestamps = items.map((i) => Date.parse(i.ts));
    for (let i = 1; i < timestamps.length; i++) {
      expect(timestamps[i]).toBeGreaterThanOrEqual(timestamps[i - 1]);
    }
    expect(items[0].kind).toBe("comment");
    expect((items[0].item as Comment).id).toBe(2);
  });

  it("returns an empty array when all three sources are empty", () => {
    expect(buildActivity([], [], [])).toEqual([]);
  });

  it("treats an unparseable timestamp as earliest rather than throwing", () => {
    const badCommit: Commit = { ...commit, authoredAt: "not-a-date" };
    const items = buildActivity([badCommit], [review], [comment]);
    expect(items[0].kind).toBe("commit");
  });
});
