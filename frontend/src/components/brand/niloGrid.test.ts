import { describe, expect, it } from "vitest";
import { cellPaths, NILO_FACE, NILO_GRID } from "./niloGrid";

describe("Nilo's shared pixel identity", () => {
  it("paints the scholar owl in her own palette: body, eyes, pupils, beak, rim", () => {
    for (const rows of [NILO_FACE, NILO_GRID]) {
      const fills = cellPaths(rows).map(([fill]) => fill).sort();
      expect(fills).toEqual(
        ["var(--nilo-beak)", "var(--nilo-body)", "var(--nilo-eye)", "var(--nilo-pupil)", "var(--nilo-rim)"].sort(),
      );
    }
  });

  it("keeps the generator-compatible 16-cell grid and the same face on the mascot", () => {
    expect(NILO_GRID).toHaveLength(13);
    expect(NILO_GRID.every((row) => row.length === 16 && /^[.BWPKR]+$/.test(row))).toBe(true);
    expect(NILO_FACE).toEqual(NILO_GRID.slice(0, 9));
  });

  it("keeps cell geometry, ignores empty cells and maps unknown letters to currentColor", () => {
    expect(cellPaths(["B.X", [".", "R", "."]])).toEqual([
      ["var(--nilo-body)", "M0 0h1v1h-1z"],
      ["currentColor", "M2 0h1v1h-1z"],
      ["var(--nilo-rim)", "M1 1h1v1h-1z"],
    ]);
  });
});
