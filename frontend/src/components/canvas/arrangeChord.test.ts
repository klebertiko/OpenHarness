import { expect, it } from "vitest";
import { matchesChord, parseChord } from "@/components/shell/keys";
import { shellNavCommands } from "@/components/shell/commands";
import { ARRANGE_CHORD } from "./CanvasDock";

const key = (init: KeyboardEventInit) => new KeyboardEvent("keydown", init);

it("Auto-arrange is Shift+L: fires on the chord, not on a bare L or a Ctrl/Alt variant", () => {
  expect(ARRANGE_CHORD).toBe("Shift+L");
  expect(matchesChord(key({ key: "L", shiftKey: true }), ARRANGE_CHORD, false)).toBe(true);
  expect(matchesChord(key({ key: "l" }), ARRANGE_CHORD, false)).toBe(false);
  expect(matchesChord(key({ key: "L", shiftKey: true, ctrlKey: true }), ARRANGE_CHORD, false)).toBe(false);
  expect(matchesChord(key({ key: "L", shiftKey: true, altKey: true }), ARRANGE_CHORD, false)).toBe(false);
  expect(matchesChord(key({ key: "L", shiftKey: true, metaKey: true }), ARRANGE_CHORD, true)).toBe(false);
});

it("does not collide with any chord the shell already owns", () => {
  const owned = [
    "Mod+K", "Mod+B", "Mod+Alt+B", "Mod+Enter", "Mod+S", "Mod+Shift+M", "Mod+Shift+E", "Mod+I",
    "Mod+Z", "Mod+Shift+Z", "Alt+1", "Alt+2", "Alt+3", "?",
    ...shellNavCommands().flatMap((c) => (c.chord ? [c.chord] : [])),
  ];
  const mine = parseChord(ARRANGE_CHORD);
  for (const spec of owned) {
    const o = parseChord(spec);
    const same = o.key.toLowerCase() === mine.key.toLowerCase() && !!o.mod === !!mine.mod && !!o.alt === !!mine.alt && !!o.shift === !!mine.shift;
    expect(same, spec).toBe(false);
  }
});
