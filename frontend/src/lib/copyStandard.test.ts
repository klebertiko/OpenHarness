import { afterEach, expect, it, vi } from "vitest";
import { BUNDLED_HARNESS_COMMAND_GROUP, fetchStudioExamples } from "./studioExamples";
import { HARNESS_PRESETS } from "./templates";

/**
 * Copy standard: everything the app ships is a "harness". Names and
 * descriptions shown in the Studio never say framework / sample / template /
 * preset / Copilot (the assistant is Nilo). A source may still be cited by its
 * project name, `skills-framework`. See CONTEXT.md.
 */
const FORBIDDEN = /framework|sample|template|preset|copilot/i;
const noForbidden = (text: string) => !FORBIDDEN.test(text.replace(/skills-framework/gi, ""));

afterEach(() => vi.unstubAllGlobals());

it("the Studio example list names no harness a sample, preset, template or framework", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
  const examples = await fetchStudioExamples();
  expect(examples.length).toBeGreaterThan(0);
  for (const ex of examples) {
    expect(noForbidden(ex.name), ex.name).toBe(true);
    expect(noForbidden(ex.description), ex.description).toBe(true);
  }
});

it("every built-in harness (preset) is named and described as a harness", () => {
  for (const p of HARNESS_PRESETS) {
    expect(noForbidden(p.name), p.name).toBe(true);
    expect(noForbidden(p.description), p.description).toBe(true);
  }
});

it("the command palette groups the bundled harnesses under the same label as the Studio actions bar (#113)", () => {
  expect(BUNDLED_HARNESS_COMMAND_GROUP).toBe("Open bundled harness");
  expect(noForbidden(BUNDLED_HARNESS_COMMAND_GROUP)).toBe(true);
});
