/**
 * Minimal parser for `pull.body` — recognises GitHub-style checklist lines
 * (`- [ ] text` / `- [x] text`) and passes everything else through as plain
 * text. Deliberately not a markdown renderer: the frontend ships no markdown
 * library, and the brief is explicit that this stays small. Checkboxes are
 * rendered inert (no persist endpoint exists to write a toggle back).
 */
export type DescriptionLine =
  | { kind: "checkbox"; text: string; checked: boolean }
  | { kind: "text"; text: string };

const CHECKBOX_RE = /^\s*[-*]\s+\[([ xX])\]\s+(.*)$/;

export function parseDescription(body: string): DescriptionLine[] {
  if (!body) return [];
  return body.split(/\r?\n/).map((line): DescriptionLine => {
    const m = CHECKBOX_RE.exec(line);
    if (m) {
      return { kind: "checkbox", text: m[2], checked: m[1].toLowerCase() === "x" };
    }
    return { kind: "text", text: line };
  });
}
