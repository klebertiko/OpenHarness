/**
 * Slot assignment for the blind comparison route.
 *
 * `/dev/v/1` and `/dev/v/2` each render whichever candidate this map points
 * them at. Nothing in the URL, the title or the markup says which is which —
 * the point is that a reviewer arriving at the two pages has no way to tell
 * from anything except the design itself.
 */
export type Candidate = "live" | "plate";

export const ASSIGN: Record<string, Candidate> = {
  "1": "plate",
  "2": "live",
};
