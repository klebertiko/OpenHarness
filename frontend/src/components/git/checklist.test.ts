import { describe, expect, it } from "vitest";

import { parseDescription } from "./checklist";

describe("parseDescription", () => {
  it("returns an empty array for an empty body", () => {
    expect(parseDescription("")).toEqual([]);
  });

  it("parses unchecked and checked checklist lines", () => {
    const lines = parseDescription("- [ ] one\n- [x] two\n- [X] three");
    expect(lines).toEqual([
      { kind: "checkbox", text: "one", checked: false },
      { kind: "checkbox", text: "two", checked: true },
      { kind: "checkbox", text: "three", checked: true },
    ]);
  });

  it("passes non-checklist lines through as plain text, unmodified", () => {
    const lines = parseDescription("## Summary\nSome prose here.");
    expect(lines).toEqual([
      { kind: "text", text: "## Summary" },
      { kind: "text", text: "Some prose here." },
    ]);
  });

  it("mixes checklist and text lines in source order", () => {
    const lines = parseDescription("Test plan\n- [ ] step one\nnotes\n- [x] step two");
    expect(lines.map((l) => l.kind)).toEqual(["text", "checkbox", "text", "checkbox"]);
  });

  it("also recognises a `*` bullet marker", () => {
    expect(parseDescription("* [x] done")).toEqual([{ kind: "checkbox", text: "done", checked: true }]);
  });
});
