import { describe, expect, it } from "vitest";
import { NILO_CANVAS, niloFrame, type Eyes } from "./niloFrames";
import { cellPaths, NILO_GRID } from "./niloGrid";

const fillOf = (letter: string) => cellPaths([letter])[0]?.[0];
const body = fillOf("B");

describe("Nilo animation frames (A+ scholar geometry)", () => {
  it("the resting frame reproduces the grid exactly, on an 18×17 canvas", () => {
    const resting = niloFrame();
    expect(resting).toHaveLength(NILO_CANVAS.h);
    expect(resting.every((row) => row.length === NILO_CANVAS.w)).toBe(true);
    // Grid sits at OX=1, OY=3.
    const region = resting.slice(3, 16).map((row) => row.slice(1, 17).join(""));
    expect(region).toEqual(NILO_GRID);
  });

  it.each<Eyes>(["open", "closed", "happy", "squint", "wink"])(
    "keeps both eyes readable behind the spectacles when %s",
    (eyes) => {
      const rows = niloFrame({ eyes });
      // Left lens interior ≈ grid (3..4, 5..6); right ≈ (11..12, 5..6). Offset +1/+3.
      for (const [x0, x1] of [
        [1 + 3, 1 + 4],
        [1 + 11, 1 + 12],
      ]) {
        const cells = [rows[3 + 5], rows[3 + 6]].flatMap((r) => r.slice(x0, x1 + 1));
        expect(cells.some((c) => c !== "." && fillOf(c) !== body)).toBe(true);
      }
    },
  );

  it("gaze moves the pupil without leaving the lens", () => {
    // Left lens centre is grid (3,6) → canvas (OX+3, OY+6) = (4, 9).
    const home = niloFrame({ look: [0, 0] });
    const down = niloFrame({ look: [0, 1] });
    const left = niloFrame({ look: [-1, 0] });
    expect(home[9][4]).toBe("P");
    expect(down[10][4]).toBe("P"); // drops a row
    expect(left[9][3]).toBe("P"); // shifts a column, still inside the rim (col 2)
  });

  it("a raised wing lifts out of the silhouette; a folded one does not", () => {
    const rest = niloFrame();
    const up = niloFrame({ wingL: "up", wingR: "up" });
    const restEdge = rest.map((r) => r[0] + r[NILO_CANVAS.w - 1]).join("");
    const upEdge = up.map((r) => r[0] + r[NILO_CANVAS.w - 1]).join("");
    expect(restEdge.replace(/\./g, "")).toBe(""); // nothing in the outer columns at rest
    expect(upEdge).toContain("B"); // wing tips now poke out
  });

  it("perked tufts add a row above the head", () => {
    const rest = niloFrame();
    const perk = niloFrame({ tufts: "perk" });
    const topRow = 3 - 1; // OY - 1
    expect(rest[topRow].includes("B")).toBe(false);
    expect(perk[topRow].includes("B")).toBe(true);
  });

  it("sleeping drifts a Z glyph above the head", () => {
    const z = niloFrame({ z: 1 });
    expect(z.flat().includes("Z")).toBe(true);
  });
});
