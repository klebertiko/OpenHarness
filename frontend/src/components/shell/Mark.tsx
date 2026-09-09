/**
 * The OpenHarness mark: a routed trace between two terminals with one junction
 * on the run. Orthogonal, square-capped, drawn on a 16px grid — the same
 * geometry the canvas draws edges with, at logo scale. No gradient, no blob,
 * no rounded-square-with-a-glyph-in-it.
 */
export function Mark({ size = 15 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      shapeRendering="crispEdges"
    >
      <path
        d="M3.5 4.5 H8.5 V11.5 H12.5"
        stroke="var(--ink-mute)"
        strokeWidth="1.25"
        shapeRendering="geometricPrecision"
      />
      <rect x="2" y="3" width="3" height="3" fill="var(--signal)" />
      <rect
        x="7"
        y="6.5"
        width="3"
        height="3"
        fill="var(--sub-000)"
        stroke="var(--ink-dim)"
        strokeWidth="1"
        shapeRendering="geometricPrecision"
      />
      <rect x="11" y="10" width="3" height="3" fill="var(--ink-dim)" />
    </svg>
  );
}
