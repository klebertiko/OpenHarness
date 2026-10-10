import { afterEach, beforeEach, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ScrollRail } from "./ScrollRail";

/** happy-dom does no layout, so give the rail the geometry of 5 cards in a 500px window. */
let scrollLeft = 0;
const geometry = { clientWidth: 500, scrollWidth: 1100 };
beforeEach(() => {
  scrollLeft = 0;
  geometry.scrollWidth = 1100;
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => geometry.clientWidth });
  Object.defineProperty(HTMLElement.prototype, "scrollWidth", { configurable: true, get: () => geometry.scrollWidth });
  Object.defineProperty(HTMLElement.prototype, "scrollLeft", { configurable: true, get: () => scrollLeft, set: (v: number) => { scrollLeft = v; } });
  HTMLElement.prototype.scrollTo = function (opts?: ScrollToOptions | number) { scrollLeft = typeof opts === "object" ? opts.left ?? 0 : 0; } as typeof HTMLElement.prototype.scrollTo;
  HTMLElement.prototype.scrollBy = function (opts?: ScrollToOptions | number) { scrollLeft += typeof opts === "object" ? opts.left ?? 0 : 0; } as typeof HTMLElement.prototype.scrollBy;
});
afterEach(() => {
  cleanup();
  for (const k of ["clientWidth", "scrollWidth", "scrollLeft"]) delete (HTMLElement.prototype as unknown as Record<string, unknown>)[k];
});

function setup() {
  render(
    <section>
      <h2 id="rail-title">Starting points</h2>
      <ScrollRail labelledBy="rail-title">
        {[1, 2, 3].map((n) => (
          <article key={n}>
            <h3>Card {n}</h3>
            <button type="button">Open {n}</button>
            <button type="button">Remove {n}</button>
          </article>
        ))}
      </ScrollRail>
    </section>,
  );
  const rail = screen.getByRole("group", { name: "Starting points" });
  const prev = () => screen.getByRole("button", { name: /Previous.*Starting points/ }) as HTMLButtonElement;
  const next = () => screen.getByRole("button", { name: /Next.*Starting points/ }) as HTMLButtonElement;
  const scrollTo = (x: number) => { act(() => { scrollLeft = x; fireEvent.scroll(rail); }); };
  return { rail, prev, next, scrollTo };
}

it("disables previous at the start and next at the end", () => {
  const { prev, next, scrollTo } = setup();
  expect(prev().disabled).toBe(true);
  expect(next().disabled).toBe(false);
  scrollTo(300);
  expect(prev().disabled).toBe(false);
  expect(next().disabled).toBe(false);
  scrollTo(600);
  expect(prev().disabled).toBe(false);
  expect(next().disabled).toBe(true);
});

it("shows an edge fade only on the side that has more content", () => {
  const { rail, scrollTo } = setup();
  expect(rail.className).not.toContain("oh-rail-fade-start");
  expect(rail.className).toContain("oh-rail-fade-end");
  scrollTo(300);
  expect(rail.className).toContain("oh-rail-fade-start");
  expect(rail.className).toContain("oh-rail-fade-end");
  scrollTo(600);
  expect(rail.className).toContain("oh-rail-fade-start");
  expect(rail.className).not.toContain("oh-rail-fade-end");
});

it("renders no controls and no fade when everything fits", () => {
  geometry.scrollWidth = 500;
  const { rail } = setup();
  expect(screen.queryByRole("button", { name: /Next/ })).toBeNull();
  expect(rail.className).not.toContain("oh-rail-fade");
});

it("the next button scrolls the rail forward", async () => {
  const { next } = setup();
  await userEvent.setup().click(next());
  expect(scrollLeft).toBeGreaterThan(0);
});

it("arrow keys move focus to the same control in the neighbouring card; Home and End jump", async () => {
  setup();
  const user = userEvent.setup();
  screen.getByRole("button", { name: "Remove 1" }).focus();
  await user.keyboard("{ArrowRight}");
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "Remove 2" }));
  await user.keyboard("{End}");
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "Remove 3" }));
  await user.keyboard("{ArrowRight}");
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "Remove 3" }));
  await user.keyboard("{ArrowLeft}{Home}");
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "Remove 1" }));
});

it("does not steal arrow keys from text fields inside a card", async () => {
  render(
    <ScrollRail labelledBy="x"><article><input aria-label="Name" /></article><article><button type="button">Other</button></article></ScrollRail>,
  );
  const user = userEvent.setup();
  screen.getByRole("textbox", { name: "Name" }).focus();
  await user.keyboard("{ArrowRight}");
  expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "Name" }));
});

it("turns a vertical wheel into horizontal travel and releases at the end", () => {
  const { rail, scrollTo } = setup();
  const wheel = () => fireEvent.wheel(rail, { deltaY: 100, cancelable: true });
  expect(wheel()).toBe(false); // handled → default prevented
  expect(scrollLeft).toBe(100);
  scrollTo(600);
  expect(wheel()).toBe(true); // at the end → the page may scroll
});
