/**
 * Pure scroll-state logic for a horizontal card rail. No DOM in here, so every
 * decision (which button is enabled, which edge fades, where a page jump lands,
 * which card a key moves to) is testable without layout.
 */

/** Fallback for the edge-fade width. The live value is `--rail-fade` in globals.css, read
 *  at runtime with `parseInset`, so CSS stays the single source of truth. */
export const RAIL_INSET = 28;
/** Sub-pixel slack: zoomed or fractional layouts can leave scrollLeft a hair short of the end. */
const EPS = 1;
/** A mouse-wheel notch is >= ~50px; trackpads stream small deltas. Notches get eased, streams do not. */
const NOTCH = 50;
const LINE_PX = 16;

export interface RailMetrics { scrollLeft: number; clientWidth: number; scrollWidth: number }
export interface Span { left: number; width: number }
export interface RailState { canPrev: boolean; canNext: boolean; fadeStart: boolean; fadeEnd: boolean }

/** `--rail-fade` as pixels; anything that is not a plain px length falls back to RAIL_INSET. */
export function parseInset(value: string): number {
  const m = /^\s*(\d+(?:\.\d+)?)px\s*$/.exec(value);
  return m ? Number(m[1]) : RAIL_INSET;
}

/**
 * A card's span in scroll-content coordinates (the space scrollLeft lives in), from
 * viewport rects. Unlike `offsetLeft` this does not depend on which ancestor happens to
 * be the card's offsetParent.
 */
export function cardSpan(card: { left: number; width: number }, rail: { left: number }, scrollLeft: number, clientLeft: number): Span {
  return { left: card.left - rail.left - clientLeft + scrollLeft, width: card.width };
}

export function railState({ scrollLeft, clientWidth, scrollWidth }: RailMetrics): RailState {
  const canPrev = scrollLeft > EPS;
  const canNext = scrollLeft + clientWidth < scrollWidth - EPS;
  // The fade says "more this way", so it follows the same truth as the button.
  return { canPrev, canNext, fadeStart: canPrev, fadeEnd: canNext };
}

export interface WheelLike { deltaX: number; deltaY: number; deltaMode: number; ctrlKey: boolean }

/**
 * A vertical wheel over the rail travels the rail sideways, but only while the rail can
 * still move that way. At an end it returns null so the page scrolls instead: the rail
 * never traps the wheel. Native horizontal gestures and pinch-zoom are never touched.
 */
export function wheelToScroll(e: WheelLike, m: RailMetrics): { left: number; smooth: boolean } | null {
  if (e.ctrlKey || Math.abs(e.deltaX) >= Math.abs(e.deltaY) || e.deltaY === 0) return null;
  const { canPrev, canNext } = railState(m);
  if (e.deltaY > 0 ? !canNext : !canPrev) return null;
  const left = e.deltaY * (e.deltaMode === 1 ? LINE_PX : 1);
  return { left, smooth: Math.abs(left) >= NOTCH };
}

/** Where (scrollLeft) a previous/next press should land: a card edge, never mid-card. */
export function pageTarget(cards: Span[], m: RailMetrics, dir: "prev" | "next", inset = RAIL_INSET): number {
  const max = Math.max(0, m.scrollWidth - m.clientWidth);
  const clamp = (x: number) => Math.min(max, Math.max(0, x));
  const viewStart = m.scrollLeft + inset;
  const viewEnd = m.scrollLeft + m.clientWidth - inset;
  if (dir === "next") {
    let i = cards.findIndex((c) => c.left + c.width > viewEnd + EPS);
    if (i === -1) return max;
    // A card wider than the viewport that already sits at the edge would never advance.
    if (cards[i].left - inset <= m.scrollLeft + EPS && i + 1 < cards.length) i += 1;
    return clamp(cards[i].left - inset);
  }
  let i = -1;
  cards.forEach((c, idx) => { if (c.left < viewStart - EPS) i = idx; });
  if (i === -1) return 0;
  // Page back by as many whole cards as fit, ending on the clipped one.
  let j = i;
  while (j > 0 && cards[i].left + cards[i].width - cards[j - 1].left <= m.clientWidth - 2 * inset) j -= 1;
  return clamp(cards[j].left - inset);
}

/**
 * scrollLeft that brings a card fully into view, clear of the edge fades, or null when
 * it already is (or the rail cannot move any further). Used when focus lands in a card,
 * so Tab and arrow keys never leave the card half-hidden under a fade.
 */
export function revealTarget(card: Span, m: RailMetrics, inset = RAIL_INSET): number | null {
  const max = Math.max(0, m.scrollWidth - m.clientWidth);
  const viewStart = m.scrollLeft + inset;
  const viewEnd = m.scrollLeft + m.clientWidth - inset;
  const right = card.left + card.width;
  let target: number;
  if (card.left < viewStart - EPS || card.width > viewEnd - viewStart) target = card.left - inset;
  else if (right > viewEnd + EPS) target = right - m.clientWidth + inset;
  else return null;
  target = Math.min(max, Math.max(0, target));
  return Math.abs(target - m.scrollLeft) <= EPS ? null : target;
}

/** Which card an arrow/Home/End key moves to, or null when the key is not ours. */
export function nextCardIndex(current: number, key: string, count: number): number | null {
  if (count <= 0) return null;
  switch (key) {
    case "ArrowRight": return Math.min(count - 1, current + 1);
    case "ArrowLeft": return Math.max(0, current - 1);
    case "Home": return 0;
    case "End": return count - 1;
    default: return null;
  }
}
