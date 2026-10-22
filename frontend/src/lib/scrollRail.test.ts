import { describe, expect, it } from "vitest";
import { RAIL_INSET, cardSpan, nextCardIndex, pageTarget, parseInset, railState, revealTarget, wheelToScroll, type RailMetrics, type Span } from "./scrollRail";

const m = (scrollLeft: number, clientWidth = 500, scrollWidth = 1100): RailMetrics => ({ scrollLeft, clientWidth, scrollWidth });
/** Five 200px cards, 12px apart, 4px lead-in: left = 4 + i * 212. */
const cards: Span[] = Array.from({ length: 5 }, (_, i) => ({ left: 4 + i * 212, width: 200 }));

describe("railState", () => {
  it("at the start only next is available and only the end fades", () => {
    expect(railState(m(0))).toEqual({ canPrev: false, canNext: true, fadeStart: false, fadeEnd: true });
  });
  it("in the middle both directions are available", () => {
    expect(railState(m(300))).toEqual({ canPrev: true, canNext: true, fadeStart: true, fadeEnd: true });
  });
  it("at the end only prev is available (sub-pixel rounding tolerated)", () => {
    expect(railState(m(600))).toEqual({ canPrev: true, canNext: false, fadeStart: true, fadeEnd: false });
    expect(railState(m(599.4))).toMatchObject({ canNext: false });
  });
  it("content that fits needs neither button nor fade", () => {
    expect(railState(m(0, 500, 500))).toEqual({ canPrev: false, canNext: false, fadeStart: false, fadeEnd: false });
  });
});

describe("wheelToScroll", () => {
  const wheel = (o: Partial<{ deltaX: number; deltaY: number; deltaMode: number; ctrlKey: boolean }>) => ({ deltaX: 0, deltaY: 0, deltaMode: 0, ctrlKey: false, ...o });
  it("turns a vertical mouse-wheel tick into horizontal travel, smoothly", () => {
    expect(wheelToScroll(wheel({ deltaY: 100 }), m(0))).toEqual({ left: 100, smooth: true });
  });
  it("applies small trackpad deltas immediately", () => {
    expect(wheelToScroll(wheel({ deltaY: 6 }), m(0))).toEqual({ left: 6, smooth: false });
  });
  it("scales line-mode deltas", () => {
    expect(wheelToScroll(wheel({ deltaY: 3, deltaMode: 1 }), m(0))).toEqual({ left: 48, smooth: false });
  });
  it("lets the page scroll once the rail is at the end in that direction", () => {
    expect(wheelToScroll(wheel({ deltaY: 100 }), m(600))).toBeNull();
    expect(wheelToScroll(wheel({ deltaY: -100 }), m(0))).toBeNull();
  });
  it("still travels back from the end", () => {
    expect(wheelToScroll(wheel({ deltaY: -100 }), m(600))).toEqual({ left: -100, smooth: true });
  });
  it("leaves native horizontal gestures and pinch-zoom alone", () => {
    expect(wheelToScroll(wheel({ deltaX: 80, deltaY: 10 }), m(100))).toBeNull();
    expect(wheelToScroll(wheel({ deltaY: 100, ctrlKey: true }), m(100))).toBeNull();
  });
  it("ignores a rail with nothing to scroll", () => {
    expect(wheelToScroll(wheel({ deltaY: 100 }), m(0, 500, 500))).toBeNull();
  });
});

describe("pageTarget", () => {
  it("next brings the first clipped card to the leading edge", () => {
    // visible region 28..472 → card 2 (left 428, right 628) is the first one clipped on the right.
    expect(pageTarget(cards, m(0), "next")).toBe(428 - RAIL_INSET);
  });
  it("next never overshoots the end", () => {
    expect(pageTarget(cards, m(500), "next")).toBe(600);
  });
  it("prev pages back by what fits, landing on a card edge", () => {
    expect(pageTarget(cards, m(400), "prev")).toBe(0);
  });
  it("prev from the first card stays at 0", () => {
    expect(pageTarget(cards, m(0), "prev")).toBe(0);
  });
  it("always makes progress when a card is wider than the viewport", () => {
    const wide: Span[] = [{ left: 4, width: 700 }, { left: 716, width: 700 }];
    expect(pageTarget(wide, m(0, 500, 1420), "next")).toBeGreaterThan(0);
  });
});

describe("nextCardIndex", () => {
  it("steps with the arrow keys and clamps at the ends", () => {
    expect(nextCardIndex(1, "ArrowRight", 4)).toBe(2);
    expect(nextCardIndex(1, "ArrowLeft", 4)).toBe(0);
    expect(nextCardIndex(3, "ArrowRight", 4)).toBe(3);
    expect(nextCardIndex(0, "ArrowLeft", 4)).toBe(0);
  });
  it("jumps with Home and End", () => {
    expect(nextCardIndex(2, "Home", 4)).toBe(0);
    expect(nextCardIndex(1, "End", 4)).toBe(3);
  });
  it("ignores every other key", () => {
    expect(nextCardIndex(1, "ArrowDown", 4)).toBeNull();
    expect(nextCardIndex(1, "a", 4)).toBeNull();
  });
  it("has no answer for an empty rail", () => {
    expect(nextCardIndex(0, "ArrowRight", 0)).toBeNull();
  });
});

describe("revealTarget", () => {
  it("does nothing for a card already clear of both fades", () => {
    expect(revealTarget(cards[1], m(100))).toBeNull();
  });
  it("brings a card clipped on the right fully into view, clear of the fade", () => {
    // card 2 spans 428..628; the clear region ends at scrollLeft + 500 - 28.
    expect(revealTarget(cards[2], m(0))).toBe(628 - 500 + RAIL_INSET);
  });
  it("brings a card clipped on the left fully into view, clear of the fade", () => {
    expect(revealTarget(cards[1], m(300))).toBe(216 - RAIL_INSET);
  });
  it("clamps at the ends and reports no move when already there", () => {
    expect(revealTarget(cards[0], m(0))).toBeNull();
    expect(revealTarget(cards[4], m(0, 500, 1000))).toBe(500);
    expect(revealTarget(cards[4], m(500, 500, 1000))).toBeNull();
  });
  it("aligns a card wider than the viewport to its leading edge", () => {
    expect(revealTarget({ left: 4, width: 700 }, m(300, 500, 1420))).toBe(0);
  });
});

describe("cardSpan", () => {
  // Rail box at viewport x=100 with a 1px border; card painted at viewport x=132 while the rail is scrolled 40px.
  it("converts viewport rects into scroll-content coordinates, whatever the offsetParent is", () => {
    expect(cardSpan({ left: 132, width: 200 }, { left: 100 }, 40, 1)).toEqual({ left: 71, width: 200 });
  });
  it("puts an unscrolled first card at the rail's own padding, not at 0", () => {
    // 4px padding, no border, nothing scrolled → the card starts at 4, where scroll-snap sees it.
    expect(cardSpan({ left: 104, width: 200 }, { left: 100 }, 0, 0)).toEqual({ left: 4, width: 200 });
  });
  it("feeds pageTarget/revealTarget so they land on the real edge, not 4px short", () => {
    const spans = [0, 286, 572, 858].map((_, i) => cardSpan({ left: 104 + i * 286, width: 272 }, { left: 100 }, 0, 0));
    expect(spans.map((c) => c.left)).toEqual([4, 290, 576, 862]);
    expect(revealTarget(spans[2], { scrollLeft: 0, clientWidth: 437, scrollWidth: 1140 })).toBe(576 + 272 - 437 + RAIL_INSET);
    expect(pageTarget(spans, { scrollLeft: 0, clientWidth: 437, scrollWidth: 1140 }, "next")).toBe(290 - RAIL_INSET);
  });
});

describe("parseInset", () => {
  it("reads the --rail-fade length so CSS stays the single source", () => {
    expect(parseInset(" 28px ")).toBe(28);
    expect(parseInset("20px")).toBe(20);
  });
  it("falls back to the default when the variable is absent or not a pixel length", () => {
    expect(parseInset("")).toBe(RAIL_INSET);
    expect(parseInset("2rem")).toBe(RAIL_INSET);
    expect(parseInset("nonsense")).toBe(RAIL_INSET);
  });
});
