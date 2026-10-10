import { useRef, useState } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { PERMISSION_MODES, nextPermissionMode, type PermissionMode } from "@/lib/permissionMode";
import { ChatComposer } from "./ChatComposer";

const send = vi.fn();
const changed = vi.fn();

function Composer({ initial = "ask", live = false, notice }: { initial?: PermissionMode; live?: boolean; notice?: string }) {
  const [value, setValue] = useState("");
  const [mode, setMode] = useState<PermissionMode>(initial);
  const ref = useRef<HTMLTextAreaElement>(null);
  return <ChatComposer value={value} onChange={setValue} onSend={send} inputRef={ref} live={live}
    permissionMode={mode} onPermissionModeChange={(next) => { changed(next); setMode(next); }} permissionNotice={notice} />;
}
const textbox = () => screen.getByRole("textbox", { name: "Message OpenHarness" }) as HTMLTextAreaElement;
const checked = () => screen.getAllByRole("radio").find((r) => r.getAttribute("aria-checked") === "true")?.textContent;

beforeEach(() => { vi.clearAllMocks(); HTMLElement.prototype.scrollIntoView = vi.fn(); });
afterEach(cleanup);

it("always shows the three modes and which one is current", () => {
  render(<Composer initial="plan" />);
  const group = screen.getByRole("radiogroup", { name: "Permission mode" });
  expect(group).toBeTruthy();
  expect(screen.getAllByRole("radio").map((r) => r.textContent)).toEqual(["Ask", "Auto", "Plan"]);
  expect(checked()).toBe("Plan");
  expect(PERMISSION_MODES).toHaveLength(3);
});

it("clicking a mode selects it", () => {
  render(<Composer />);
  fireEvent.click(screen.getByRole("radio", { name: /Auto/ }));
  expect(changed).toHaveBeenCalledWith("auto_workspace");
  expect(checked()).toBe("Auto");
});

it("Shift+Tab in the composer cycles the mode instead of moving focus", () => {
  render(<Composer />);
  const input = textbox(); input.focus();
  const seen: (string | undefined)[] = [];
  for (let i = 0; i < 3; i++) {
    const notCancelled = fireEvent.keyDown(input, { key: "Tab", shiftKey: true });
    expect(notCancelled).toBe(false); // preventDefault was called
    seen.push(checked());
  }
  expect(seen).toEqual(["Auto", "Plan", "Ask"]);
  expect(changed.mock.calls.map((c) => c[0])).toEqual(["auto_workspace", "plan", "ask"]);
  expect(document.activeElement).toBe(input);
});

it("cycling follows nextPermissionMode, the same order the store uses", () => {
  render(<Composer initial="auto_workspace" />);
  fireEvent.keyDown(textbox(), { key: "Tab", shiftKey: true });
  expect(changed).toHaveBeenCalledWith(nextPermissionMode("auto_workspace"));
});

it("plain Tab and Mod+Shift+Tab are left alone", () => {
  render(<Composer />);
  expect(fireEvent.keyDown(textbox(), { key: "Tab" })).toBe(true);
  expect(fireEvent.keyDown(textbox(), { key: "Tab", shiftKey: true, ctrlKey: true })).toBe(true);
  expect(changed).not.toHaveBeenCalled();
});

it("Shift+Tab does not cycle while an IME composition is in progress", () => {
  render(<Composer />);
  fireEvent.keyDown(textbox(), { key: "Tab", shiftKey: true, keyCode: 229 });
  expect(changed).not.toHaveBeenCalled();
});

it("Shift+Tab wins over the slash menu instead of selecting an option", () => {
  render(<Composer />);
  fireEvent.change(textbox(), { target: { value: "/" } });
  expect(screen.getByRole("listbox", { name: "Commands and skills" })).toBeTruthy();
  fireEvent.keyDown(textbox(), { key: "Tab", shiftKey: true });
  expect(changed).toHaveBeenCalledWith("auto_workspace");
});

it("cannot be changed while a run is live", () => {
  render(<Composer live />);
  for (const radio of screen.getAllByRole("radio")) expect((radio as HTMLButtonElement).disabled).toBe(true);
});

it("says out loud when the backend refused a change", () => {
  render(<Composer notice="Não foi possível salvar o modo" />);
  expect(screen.getByRole("alert").textContent).toContain("Não foi possível salvar o modo");
});

it("renders no selector when the parent does not wire a mode (older callers)", () => {
  const Plain = () => { const ref = useRef<HTMLTextAreaElement>(null); return <ChatComposer value="" onChange={() => {}} onSend={send} inputRef={ref} live={false} />; };
  render(<Plain />);
  expect(screen.queryByRole("radiogroup")).toBeNull();
});
