import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Combobox, type ComboOption } from "./Combobox";

/* providers-recovery F9: one keyboard-first, viewport-safe picker for every
   provider/model/harness/folder choice, instead of three hand-rolled popovers
   with different focus, close and positioning bugs. */

const OPTIONS: ComboOption[] = [
  { id: "a", label: "Alpha", detail: "first" },
  { id: "b", label: "Bravo", detail: "second", disabled: true },
  { id: "c", label: "Charlie", detail: "third" },
];

function Harness(props: Partial<React.ComponentProps<typeof Combobox>> & { initial?: string | null }) {
  const [value, setValue] = useState<string | null>(props.initial ?? "a");
  return (
    <>
      <button type="button">outside</button>
      <Combobox
        label="Letter"
        triggerLabel={`Letter: ${value ?? "none"}`}
        value={value}
        options={OPTIONS}
        trigger={<span>{value}</span>}
        {...props}
        onChange={(id) => {
          setValue(id);
          props.onChange?.(id);
        }}
      />
    </>
  );
}

const trigger = () => screen.getByRole("button", { name: /^Letter:/ });
const activeOption = () => {
  const owner = document.activeElement as HTMLElement;
  const id = owner.getAttribute("aria-activedescendant");
  return id ? document.getElementById(id) : null;
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("Combobox", () => {
  it("opens from the trigger with focus on the labelled list and the current value active", () => {
    render(<Harness />);
    expect(trigger().getAttribute("aria-haspopup")).toBe("listbox");
    expect(trigger().getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(trigger());
    const list = screen.getByRole("listbox", { name: "Letter" });
    expect(trigger().getAttribute("aria-expanded")).toBe("true");
    expect(trigger().getAttribute("aria-controls")).toBe(list.id);
    expect(document.activeElement).toBe(list);
    expect(activeOption()?.textContent).toContain("Alpha");
    expect(screen.getByRole("option", { name: /Alpha/ }).getAttribute("aria-selected")).toBe("true");
  });

  it("ArrowDown on the closed trigger opens it", () => {
    render(<Harness />);
    trigger().focus();
    fireEvent.keyDown(trigger(), { key: "ArrowDown" });
    expect(screen.getByRole("listbox")).toBeTruthy();
  });

  it("arrows skip disabled options; Enter selects, closes and returns focus to the trigger", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    fireEvent.click(trigger());
    const list = screen.getByRole("listbox");
    fireEvent.keyDown(list, { key: "ArrowDown" });
    expect(activeOption()?.textContent).toContain("Charlie");
    fireEvent.keyDown(list, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith("c");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(document.activeElement).toBe(trigger());
  });

  it("a disabled option cannot be chosen by click", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    fireEvent.click(trigger());
    fireEvent.click(screen.getByRole("option", { name: /Bravo/ }));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("option", { name: /Bravo/ }).getAttribute("aria-disabled")).toBe("true");
  });

  it("Escape closes without choosing and refocuses the trigger", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    fireEvent.click(trigger());
    fireEvent.keyDown(screen.getByRole("listbox"), { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(trigger());
  });

  it("a pointer press outside closes it", () => {
    render(<Harness />);
    fireEvent.click(trigger());
    fireEvent.pointerDown(screen.getByRole("button", { name: "outside" }));
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("keepOpen keeps the list open after a choice", () => {
    render(<Harness keepOpen={(id) => id === "c"} />);
    fireEvent.click(trigger());
    fireEvent.click(screen.getByRole("option", { name: /Charlie/ }));
    expect(screen.getByRole("listbox")).toBeTruthy();
  });

  it("searchable: focus goes to a labelled filter, typing filters, and an empty result says so", () => {
    render(<Harness searchable emptyText="No letters" />);
    fireEvent.click(trigger());
    const input = screen.getByRole("combobox", { name: "Filter Letter" });
    expect(document.activeElement).toBe(input);
    expect(input.getAttribute("aria-controls")).toBe(screen.getByRole("listbox").id);
    fireEvent.change(input, { target: { value: "char" } });
    expect(screen.getAllByRole("option")).toHaveLength(1);
    expect(activeOption()?.textContent).toContain("Charlie");
    fireEvent.change(input, { target: { value: "zzz" } });
    expect(screen.queryAllByRole("option")).toHaveLength(0);
    expect(screen.getByText("No letters")).toBeTruthy();
  });

  it("allowCustom offers the typed value and chooses it", () => {
    const onChange = vi.fn();
    render(<Harness searchable allowCustom onChange={onChange} />);
    fireEvent.click(trigger());
    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "delta:7b" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith("delta:7b");
  });

  it("states: loading and error are announced, not shown as an empty list", () => {
    const { rerender } = render(<Harness options={[]} status="loading" loadingText="Loading letters…" />);
    fireEvent.click(trigger());
    expect(screen.getByRole("status")?.textContent).toContain("Loading letters…");
    rerender(<Harness options={[]} status="error" errorText="Couldn't load letters" />);
    expect(screen.getByRole("alert")?.textContent).toContain("Couldn't load letters");
  });

  it("stays inside the viewport: clamps to the right edge and opens downward near the top", () => {
    render(<Harness width={300} />);
    const rect = { left: 700, right: 760, top: 10, bottom: 42, width: 60, height: 32, x: 700, y: 10, toJSON: () => ({}) };
    vi.spyOn(trigger(), "getBoundingClientRect").mockReturnValue(rect as DOMRect);
    act(() => {
      Object.defineProperty(window, "innerWidth", { configurable: true, value: 768 });
      Object.defineProperty(window, "innerHeight", { configurable: true, value: 800 });
    });
    fireEvent.click(trigger());
    const pop = screen.getByRole("listbox").closest("[data-combobox-popover]") as HTMLElement;
    const left = parseFloat(pop.style.left);
    expect(left + 300).toBeLessThanOrEqual(768 - 8);
    expect(pop.style.top).toBe("48px");
    expect(pop.style.bottom).toBe("");
  });
});
