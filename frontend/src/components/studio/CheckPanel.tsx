"use client";
import { RefreshCw, X } from "lucide-react";
import { useReactFlow } from "@xyflow/react";
import { useCanvasStore } from "@/store/canvasStore";
import type { Problem, Readiness } from "@/lib/readiness";
import { currentDraftKey, useReadinessStore } from "./readinessStore";

/**
 * What the readiness pill and the Run menu open under the header: the
 * Problems list, or the simulation plan. One region at a time, one Close.
 */

const focusRing = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal";
const small = `inline-flex h-7 items-center gap-1.5 rounded-control px-2 text-[12px] text-ink-dim transition-colors hover:bg-sub-200 hover:text-ink disabled:opacity-40 ${focusRing}`;

function Shell({ title, onClose, children, actions }: { title: string; onClose: () => void; children: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <section role="region" aria-label={title} className="border-t border-line-soft bg-sub-000/40 px-3 py-2">
      <div className="mb-1 flex items-center gap-2">
        <h2 className="text-[12px] font-semibold text-ink">{title}</h2>
        <span className="flex-1" />
        {actions}
        <button type="button" aria-label="Close" onClick={onClose} className={small}>
          <X size={14} aria-hidden />
        </button>
      </div>
      <div className="max-h-[200px] overflow-y-auto">{children}</div>
    </section>
  );
}

const empty: Record<Readiness["state"], string> = {
  empty: "Add a block and this will check the harness as you build it.",
  checking: "Checking the harness…",
  ready: "Nothing to fix. This harness is ready to run.",
  review: "",
  problems: "",
  offline: "The local engine can't be reached, so the harness can't be checked. Editing still works.",
};

function ProblemRow({ problem, reveal }: { problem: Problem; reveal: (id: string) => void }) {
  const kind = problem.severity === "problem" ? "Problem" : "To review";
  const body = (
    <>
      <span className={`w-[68px] flex-none text-[11px] ${problem.severity === "problem" ? "text-fault" : "text-warn"}`}>{kind}</span>
      <span className="flex-none text-[12px] font-medium text-ink">{problem.label}</span>
      <span className="min-w-0 flex-1 text-[12px] text-ink-mute [overflow-wrap:anywhere]">{problem.note}</span>
    </>
  );
  return (
    <li>
      {problem.nodeId ? (
        <button type="button" onClick={() => reveal(problem.nodeId!)} className={`flex w-full items-baseline gap-2 rounded-control px-1.5 py-1 text-left hover:bg-sub-200 ${focusRing}`}>
          {body}
        </button>
      ) : (
        <div className="flex items-baseline gap-2 px-1.5 py-1">{body}</div>
      )}
    </li>
  );
}

export function CheckPanel() {
  const panel = useReadinessStore((s) => s.panel);
  const summary = useReadinessStore((s) => s.summary);
  const plan = useReadinessStore((s) => s.plan);
  const closePanel = useReadinessStore((s) => s.closePanel);
  const recheck = useReadinessStore((s) => s.recheck);
  const setSelectedNode = useCanvasStore((s) => s.setSelectedNode);
  const { getNode, setCenter } = useReactFlow();

  const reveal = (nodeId: string) => {
    setSelectedNode(nodeId);
    const n = getNode(nodeId);
    if (n) setCenter(n.position.x + 106, n.position.y + 50, { zoom: 1, duration: 260 });
  };

  if (panel === "problems") {
    return (
      <Shell
        title="Problems"
        onClose={closePanel}
        actions={
          <button type="button" onClick={recheck} className={small}>
            <RefreshCw size={13} aria-hidden /> Check again
          </button>
        }
      >
        {summary.problems.length === 0 ? (
          <p role="status" className="py-1 text-[12px] text-ink-mute">{empty[summary.state]}</p>
        ) : (
          <ul className="space-y-0.5">
            {summary.problems.map((p) => <ProblemRow key={p.id} problem={p} reveal={reveal} />)}
          </ul>
        )}
      </Shell>
    );
  }

  if (panel === "plan") {
    const stale = plan.status === "ok" && plan.forKey !== currentDraftKey();
    return (
      <Shell title="Simulation plan" onClose={closePanel}>
        <p role="status" className={`text-[12px] ${plan.status === "error" ? "text-fault" : "text-ink-mute"}`}>{plan.message}</p>
        {stale && <p className="text-[12px] text-warn">The harness has changed since this plan was made.</p>}
        {plan.errors.length > 0 && (
          <ul className="mt-1 space-y-0.5">{plan.errors.map((e, i) => <li key={i} className="text-[12px] text-fault">{e}</li>)}</ul>
        )}
        {plan.steps.length > 0 && (
          <ol className="mt-1 space-y-0.5">
            {plan.steps.map((s, i) => (
              <li key={s.nodeId + i} className="text-[12px] text-ink-dim">
                {i + 1}. {s.role} ({s.nodeId}) — {s.status}{s.note ? ` · ${s.note}` : ""}
              </li>
            ))}
          </ol>
        )}
      </Shell>
    );
  }
  return null;
}
