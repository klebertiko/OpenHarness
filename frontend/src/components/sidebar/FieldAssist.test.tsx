import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/lib/copilot/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/copilot/api")>();
  return { ...actual, assistField: vi.fn() };
});

import { assistField, CopilotApiError } from "@/lib/copilot/api";
import { useCanvasStore } from "@/store/canvasStore";
import { FieldAssist } from "./FieldAssist";

const mockAssist = vi.mocked(assistField);
const S = () => useCanvasStore.getState();
const reply = (over = {}) => ({ text: "You are the Reviewer agent.", notes: ["Drafted offline from your intent — edit freely."], source: "offline" as const, tokens: 0, ...over });

function seed(data: Record<string, unknown> = {}, type: "agent" | "gate" | "skill" = "agent") {
  useCanvasStore.setState({ isRunning: false, _history: [], _historyIndex: -1 });
  S().loadGraph(
    [
      { id: "w", type: "agent", position: { x: 0, y: 0 }, data: { label: "Writer" } },
      { id: "n", type, position: { x: 280, y: 0 }, data: { label: "Reviewer", systemPrompt: "", ...data } },
      { id: "q", type: "gate", position: { x: 560, y: 0 }, data: { label: "QA Gate" } },
    ],
    [
      { id: "e1", source: "w", target: "n", sourceHandle: "out", targetHandle: "in", data: { kind: "flow" } },
      { id: "e2", source: "n", target: "q", sourceHandle: "out", targetHandle: "in", data: { kind: "flow" } },
    ],
  );
  S().setSelectedNode("n");
}

beforeEach(() => {
  mockAssist.mockReset();
});
afterEach(cleanup);

const open = async (user: ReturnType<typeof userEvent.setup>) => user.click(screen.getByRole("button", { name: "Assist" }));

describe("FieldAssist", () => {
  it("drafts from an intent, shows the suggestion, and Use this is one undo step", async () => {
    seed();
    mockAssist.mockResolvedValue(reply());
    const user = userEvent.setup();
    render(<FieldAssist nodeId="n" field="systemPrompt" />);
    expect(screen.getByRole("button", { name: "Assist" }).getAttribute("aria-expanded")).toBe("false");
    await open(user);
    expect(screen.getByRole("button", { name: "Assist" }).getAttribute("aria-expanded")).toBe("true");
    await user.type(screen.getByRole("textbox", { name: "What should it do?" }), "review pull requests for test coverage");
    await user.click(screen.getByRole("button", { name: "Draft" }));

    expect(mockAssist).toHaveBeenCalledTimes(1);
    expect(mockAssist.mock.calls[0][0]).toMatchObject({
      field: "systemPrompt",
      action: "draft",
      intent: "review pull requests for test coverage",
      node: { type: "agent", label: "Reviewer" },
      mode: "mock",
    });
    expect(await screen.findByText("You are the Reviewer agent.")).toBeTruthy();
    expect(screen.getByText("Offline draft")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Use this" }));
    expect(S().nodes.find((n) => n.id === "n")!.data.systemPrompt).toBe("You are the Reviewer agent.");
    S().undo();
    expect(S().nodes.find((n) => n.id === "n")!.data.systemPrompt).toBe("");
  });

  it("describes the neighbours it can see without leaking credentials", async () => {
    seed({ secretRef: "vault://k", apiKey: "sk-secret-0123456789012345", endpoint: "https://evil.test", providerIds: ["p1"], model: "m" });
    mockAssist.mockResolvedValue(reply());
    const user = userEvent.setup();
    render(<FieldAssist nodeId="n" field="systemPrompt" />);
    await open(user);
    await user.type(screen.getByRole("textbox", { name: "What should it do?" }), "x");
    await user.click(screen.getByRole("button", { name: "Draft" }));
    const req = mockAssist.mock.calls[0][0];
    expect(req.neighbours).toEqual([
      { direction: "in", type: "agent", label: "Writer", port: "out" },
      { direction: "out", type: "gate", label: "QA Gate", port: "in" },
    ]);
    const text = JSON.stringify(req);
    expect(text).not.toMatch(/vault:\/\/k|sk-secret|evil\.test|secretRef|apiKey|endpoint|providerIds/);
  });

  it("offers Improve and Review for a non-empty field; Review lists notes and Improve with these sends them as focus", async () => {
    seed({ systemPrompt: "You are QA." });
    mockAssist.mockResolvedValueOnce({ text: null, notes: ["Too short.", "No hand-off."], source: "offline", tokens: 0 });
    const user = userEvent.setup();
    render(<FieldAssist nodeId="n" field="systemPrompt" />);
    await open(user);
    expect(screen.getByRole("button", { name: "Improve" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Review" }));
    expect(mockAssist.mock.calls[0][0]).toMatchObject({ action: "review", current: "You are QA." });
    expect(await screen.findByText("Too short.")).toBeTruthy();
    expect(screen.getByText("No hand-off.")).toBeTruthy();

    mockAssist.mockResolvedValueOnce(reply({ text: "Goal: x\nYou are QA." }));
    await user.click(screen.getByRole("button", { name: "Improve with these" }));
    expect(mockAssist.mock.calls[1][0]).toMatchObject({ action: "improve", focus: "Too short.\nNo hand-off." });
    expect(await screen.findByText(/Goal: x/)).toBeTruthy();
  });

  it("Discard clears the suggestion without touching the node", async () => {
    seed();
    mockAssist.mockResolvedValue(reply());
    const user = userEvent.setup();
    render(<FieldAssist nodeId="n" field="systemPrompt" />);
    await open(user);
    await user.type(screen.getByRole("textbox", { name: "What should it do?" }), "x");
    await user.click(screen.getByRole("button", { name: "Draft" }));
    await screen.findByText("You are the Reviewer agent.");
    await user.click(screen.getByRole("button", { name: "Discard" }));
    expect(screen.queryByText("You are the Reviewer agent.")).toBeNull();
    expect(S().nodes.find((n) => n.id === "n")!.data.systemPrompt).toBe("");
  });

  it("Cancel aborts the request and returns to idle", async () => {
    seed();
    mockAssist.mockImplementation(
      (_r, signal) => new Promise((_, reject) => signal!.addEventListener("abort", () => reject(new DOMException("a", "AbortError")))),
    );
    const user = userEvent.setup();
    render(<FieldAssist nodeId="n" field="systemPrompt" />);
    await open(user);
    await user.type(screen.getByRole("textbox", { name: "What should it do?" }), "x");
    await user.click(screen.getByRole("button", { name: "Draft" }));
    expect(await screen.findByText(/Working/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByText(/Working/)).toBeNull());
    expect(screen.getByRole("button", { name: "Draft" })).toBeTruthy();
  });

  it("maps errors to human text", async () => {
    seed();
    mockAssist.mockRejectedValue(new CopilotApiError(422, { error: "assist_invalid" }));
    const user = userEvent.setup();
    render(<FieldAssist nodeId="n" field="systemPrompt" />);
    await open(user);
    await user.type(screen.getByRole("textbox", { name: "What should it do?" }), "x");
    await user.click(screen.getByRole("button", { name: "Draft" }));
    expect(await screen.findByText(/didn't fit the field rules/)).toBeTruthy();
  });

  it("is disabled while a run owns the graph", () => {
    seed();
    S().setRunning(true);
    render(<FieldAssist nodeId="n" field="systemPrompt" />);
    expect((screen.getByRole("button", { name: "Assist" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("assists a gate checklist", async () => {
    seed({ checklist: "" }, "gate");
    mockAssist.mockResolvedValue(reply({ text: "- Tests pass.\n- Evidence is attached for every item" }));
    const user = userEvent.setup();
    render(<FieldAssist nodeId="n" field="checklist" />);
    await open(user);
    await user.type(screen.getByRole("textbox", { name: "What should it do?" }), "tests pass");
    await user.click(screen.getByRole("button", { name: "Draft" }));
    await user.click(await screen.findByRole("button", { name: "Use this" }));
    expect(S().nodes.find((n) => n.id === "n")!.data.checklist).toContain("Tests pass");
  });
});
