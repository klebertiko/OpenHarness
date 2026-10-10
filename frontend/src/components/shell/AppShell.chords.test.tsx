import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { Keyboard } from "lucide-react";
import { AppShell } from "./AppShell";
import type { Command } from "./commands";

vi.mock("@/components/providers/providerStore", () => ({
  useProviderStore: (sel: (s: { hydrate: () => Promise<void> }) => unknown) => sel({ hydrate: async () => {} }),
}));

const arrange = vi.fn();
const run = vi.fn();

const commands: Command[] = [
  { id: "arrange", label: "Auto-arrange graph", group: "Edit", icon: Keyboard, chord: "Shift+L", run: arrange },
  { id: "run", label: "Run harness", group: "Run", icon: Keyboard, chord: "Mod+Enter", run },
];

const renderShell = (extra: React.ReactNode = null) =>
  render(
    <AppShell
      commands={commands}
      harnessName="h"
      onHarnessNameChange={() => {}}
      mode="Studio"
      running={false}
      nodeCount={2}
      edgeCount={1}
      selectedId={null}
      backendOk
      toolbar={null}
      left={null}
      right={null}
      stage={<main>{extra}</main>}
    />
  );

/** Fire a keydown at `target` the way the browser does: it bubbles to window. */
const press = (target: Element, init: KeyboardEventInit) =>
  target.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }));

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

it("Shift+L on the page body runs Auto-arrange", () => {
  renderShell();
  press(document.body, { key: "L", shiftKey: true });
  expect(arrange).toHaveBeenCalledOnce();
});

it("Shift+L typed into an <input> or <textarea> is a letter, not a command", () => {
  const { container } = renderShell(<><input aria-label="name" /><textarea aria-label="notes" /></>);
  press(container.querySelector("input")!, { key: "L", shiftKey: true });
  press(container.querySelector("textarea")!, { key: "L", shiftKey: true });
  expect(arrange).not.toHaveBeenCalled();
});

it("Shift+L inside a listbox, menu or combobox (typeahead) does not arrange", () => {
  const { container } = renderShell(
    <>
      <div role="listbox"><div role="option" tabIndex={0}>Local</div></div>
      <div role="menu"><div role="menuitem" tabIndex={0}>Launch</div></div>
      <div role="combobox" tabIndex={0}>Model</div>
    </>
  );
  for (const el of container.querySelectorAll('[role="option"],[role="menuitem"],[role="combobox"]')) {
    press(el, { key: "L", shiftKey: true });
  }
  expect(arrange).not.toHaveBeenCalled();
});

it("Mod chords still fire from inside an input", () => {
  const { container } = renderShell(<input aria-label="name" />);
  press(container.querySelector("input")!, { key: "Enter", ctrlKey: true });
  expect(run).toHaveBeenCalledOnce();
});
