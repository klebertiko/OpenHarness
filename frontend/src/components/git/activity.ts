import type { Comment, Commit, Review } from "@/lib/reposApi";

/**
 * Interleaves three real, separately-fetched sources — commits, reviews,
 * comments — into one chronological feed using each item's own real
 * timestamp. No synthetic "opened this PR" entry is injected: that event
 * isn't a field any endpoint returns, so it would be fabricated.
 */
export type ActivityItem =
  | { kind: "commit"; ts: string; item: Commit }
  | { kind: "review"; ts: string; item: Review }
  | { kind: "comment"; ts: string; item: Comment };

function tsValue(ts: string): number {
  const v = Date.parse(ts);
  return Number.isNaN(v) ? 0 : v;
}

export function buildActivity(
  commits: Commit[],
  reviews: Review[],
  comments: Comment[]
): ActivityItem[] {
  const items: ActivityItem[] = [
    ...commits.map((c): ActivityItem => ({ kind: "commit", ts: c.authoredAt, item: c })),
    ...reviews.map((r): ActivityItem => ({ kind: "review", ts: r.submittedAt, item: r })),
    ...comments.map((c): ActivityItem => ({ kind: "comment", ts: c.createdAt, item: c })),
  ];
  return items.sort((a, b) => tsValue(a.ts) - tsValue(b.ts));
}
