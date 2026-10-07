"use client";
import { create } from "zustand";
import { useShellStore } from "@/components/shell/shellStore";
import { CopilotApiError, planGraphEdit } from "@/lib/copilot/api";
import type { RequestMode } from "@/lib/copilot/contract";
import { describeOps, diffMarks, materializeOps, validateOps, type OpLine } from "@/lib/copilot/ops";
import { toCopilotGraph } from "@/lib/copilot/serialize";
import { useCanvasStore } from "./canvasStore";

export interface Proposal {
  /** `canvasStore.headSeq()` right after the proposal was applied. */
  seq: number;
  lines: OpLine[];
  state: "open" | "kept" | "undone";
}

export interface TurnError {
  text: string;
  /** The prompt to resend on "Try again". */
  retry?: string;
  link?: "providers";
}

export interface Turn {
  id: string;
  role: "user" | "assistant";
  text: string;
  source?: "model" | "offline";
  error?: TurnError;
  proposal?: Proposal;
}

type Tab = "inspector" | "copilot";
type Marks = Record<string, "added" | "changed">;

interface CopilotState {
  open: boolean;
  tab: Tab;
  turns: Turn[];
  status: "idle" | "working" | "error";
  marks: Marks;
  abort: AbortController | null;

  openCopilot: () => void;
  close: () => void;
  setTab: (tab: Tab) => void;
  send: (text: string, opts?: { mode?: RequestMode; connectionId?: string | null }) => Promise<void>;
  cancel: () => void;
  keep: (turnId: string) => void;
  undo: (turnId: string) => void;
  undoAvailable: (turnId: string) => boolean;
  reset: () => void;
}

const HISTORY_TURNS = 6;
const newId = () => crypto.randomUUID();

const isAbort = (err: unknown) => err instanceof DOMException && err.name === "AbortError";

/** Error text for a person, always with a next action (spec §3.2). */
export function describeFailure(err: unknown): { text: string; link?: "providers" } {
  if (err instanceof CopilotApiError) {
    const { error, detail } = err.body;
    if (err.status === 402) return { text: detail ?? "The monthly budget is used up.", link: "providers" };
    if (error === "plan_invalid") return { text: "Copilot's proposal didn't fit the graph rules" };
    if (error === "payload_too_large") return { text: "This graph is too large for Copilot (60 blocks and 120 wires at most)." };
    if (error === "provider_timeout") return { text: detail ?? "The provider took too long to answer." };
    if (error === "provider_unavailable") return { text: detail ?? "No provider is ready. Connect one in Providers." };
    if (error === "provider_error") return { text: detail ?? "The provider returned an error." };
    return { text: detail ?? `Copilot couldn't answer (${error}).` };
  }
  return { text: "Couldn't reach the app backend. Check that it is running." };
}

function settle(turns: Turn[], pick: (p: Proposal) => Proposal["state"] | null): Turn[] {
  return turns.map((t) => {
    const next = t.proposal && pick(t.proposal);
    return t.proposal && next ? { ...t, proposal: { ...t.proposal, state: next } } : t;
  });
}

export const useCopilotStore = create<CopilotState>((set, get) => ({
  open: false,
  tab: "inspector",
  turns: [],
  status: "idle",
  marks: {},
  abort: null,

  openCopilot: () => {
    set({ open: true, tab: "copilot" });
    useShellStore.getState().setRightOpen(true);
  },
  close: () => set({ open: false, tab: "inspector" }),
  setTab: (tab) => set({ tab }),

  send: async (text, opts = {}) => {
    const canvas = useCanvasStore.getState();
    // A pending proposal is accepted by moving on.
    set({ turns: settle(get().turns, (p) => (p.state === "open" ? "kept" : null)), marks: {} });

    const history = get()
      .turns.filter((t) => !t.error)
      .slice(-HISTORY_TURNS)
      .map((t) => ({ role: t.role, text: t.text }));
    const controller = new AbortController();
    get().abort?.abort();
    set({
      turns: [...get().turns, { id: newId(), role: "user", text }],
      status: "working",
      abort: controller,
    });

    const fail = (error: TurnError) =>
      set({ turns: [...get().turns, { id: newId(), role: "assistant", text: "", error }], status: "idle", abort: null });

    try {
      const res = await planGraphEdit(
        {
          message: text,
          history,
          graph: toCopilotGraph(canvas.nodes, canvas.edges),
          mode: opts.mode ?? "mock",
          connection_id: opts.connectionId ?? null,
        },
        controller.signal,
      );
      if (controller.signal.aborted) return;

      // The graph can change while the model is thinking: re-validate against
      // the live canvas, never against the snapshot we sent.
      const live = useCanvasStore.getState();
      const liveGraph = toCopilotGraph(live.nodes, live.edges);
      const ops = Array.isArray(res.ops) ? res.ops : null;
      const checked = ops && validateOps(liveGraph, ops);
      if (!ops || !checked || !checked.ok) return fail({ text: "The graph changed while Copilot was working", retry: text });

      let proposal: Proposal | undefined;
      let marks: Marks = {};
      if (ops.length > 0) {
        const before = live.nodes;
        const next = materializeOps(live.nodes, live.edges, ops);
        const seq = useCanvasStore.getState().applyGraphPatch(next.nodes, next.edges);
        if (seq === null) return fail({ text: "Stop the run to apply changes", retry: text });
        marks = diffMarks(before, next.nodes);
        proposal = { seq, lines: describeOps(ops, liveGraph), state: "open" };
      }
      set({
        turns: [
          ...get().turns,
          { id: newId(), role: "assistant", text: String(res.summary ?? ""), source: res.source, proposal },
        ],
        marks,
        status: "idle",
        abort: null,
      });
    } catch (err) {
      if (isAbort(err) || controller.signal.aborted) return;
      fail({ ...describeFailure(err), retry: text });
    }
  },

  cancel: () => {
    get().abort?.abort();
    set({ status: "idle", abort: null });
  },

  keep: (turnId) =>
    set({
      turns: get().turns.map((t) => (t.id === turnId && t.proposal ? { ...t, proposal: { ...t.proposal, state: "kept" } } : t)),
      marks: {},
    }),

  undoAvailable: (turnId) => {
    const proposal = get().turns.find((t) => t.id === turnId)?.proposal;
    return !!proposal && proposal.state === "open" && useCanvasStore.getState().headSeq() === proposal.seq;
  },

  undo: (turnId) => {
    if (!get().undoAvailable(turnId)) return;
    useCanvasStore.getState().undo();
    set({
      turns: get().turns.map((t) => (t.id === turnId && t.proposal ? { ...t, proposal: { ...t.proposal, state: "undone" } } : t)),
      marks: {},
    });
  },

  reset: () => {
    get().abort?.abort();
    set({ turns: [], status: "idle", marks: {}, abort: null });
  },
}));
