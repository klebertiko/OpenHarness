"use client";
import { useMemo } from "react";
import { useReactFlow } from "@xyflow/react";
import { useCanvasStore } from "@/store/canvasStore";
import { PORTS } from "@/lib/ports";
import type { HarnessNode, NodeType } from "@/lib/types";

/**
 * Graph audit — top right, floating.
 *
 * A visual editor that will happily let you draw a harness that cannot run is
 * a drawing tool. These are the three faults that actually stop a run, checked
 * against the real graph on every change, and each one is a button that
 * selects and centres the offending node. Nothing here is advisory or
 * stylistic: if the strip is clear, the graph is wireable.
 */

interface Fault {
  nodeId: string;
  label: string;
  note: string;
}

function audit(nodes: HarnessNode[], edges: { source: string; target: string }[]): Fault[] {
  const faults: Fault[] = [];
  const hasIn = new Set(edges.map((e) => e.target));
  const hasOut = new Set(edges.map((e) => e.source));

  for (const n of nodes) {
    const type = n.type as NodeType;
    const schema = PORTS[type];
    if (schema.in.length > 0 && !hasIn.has(n.id)) {
      faults.push({
        nodeId: n.id,
        label: String(n.data.label ?? n.id),
        note: "never reached",
      });
    } else if (schema.out.length > 0 && !hasOut.has(n.id)) {
      faults.push({
        nodeId: n.id,
        label: String(n.data.label ?? n.id),
        note: "dead end",
      });
    }
  }
  return faults;
}

export function GraphAudit() {
  const nodes = useCanvasStore((s) => s.nodes);
  const edges = useCanvasStore((s) => s.edges);
  const setSelectedNode = useCanvasStore((s) => s.setSelectedNode);
  const { setCenter, getNode } = useReactFlow();

  const faults = useMemo(() => audit(nodes, edges), [nodes, edges]);
  const noEntry = nodes.length > 0 && !nodes.some((n) => n.type === "input");

  if (nodes.length === 0) return null;

  const reveal = (nodeId: string) => {
    setSelectedNode(nodeId);
    const n = getNode(nodeId);
    if (n) setCenter(n.position.x + 106, n.position.y + 50, { zoom: 1, duration: 260 });
  };

  const clean = faults.length === 0 && !noEntry;

  return (
    <div className="pointer-events-none absolute right-[10px] top-[10px] z-10 flex w-[188px] flex-col items-end gap-[5px]">
      <div className="oh-float pointer-events-auto flex h-[24px] w-full items-center gap-2 px-2">
        <span
          aria-hidden
          className="h-[6px] w-[6px] flex-none rounded-[1px]"
          style={{ background: clean ? "var(--signal-deep)" : "var(--warn)" }}
        />
        <span className="t-label flex-1 text-ink-dim">
          {clean ? "Graph wireable" : `${faults.length + (noEntry ? 1 : 0)} unwired`}
        </span>
        <span className="t-meta text-ink-faint">
          {nodes.length}n·{edges.length}e
        </span>
      </div>

      {noEntry && (
        <div className="oh-float pointer-events-auto flex w-full items-center gap-2 px-2 py-[4px]">
          <span className="t-body flex-1 truncate text-ink-mute">No input node</span>
          <span className="t-meta flex-none text-warn">entry</span>
        </div>
      )}

      {faults.slice(0, 4).map((f) => (
        <button
          key={f.nodeId}
          type="button"
          onClick={() => reveal(f.nodeId)}
          className="oh-float pointer-events-auto flex w-full items-center gap-2 px-2 py-[4px] text-left transition-colors hover:bg-sub-200"
        >
          <span className="t-body flex-1 truncate text-ink-dim">{f.label}</span>
          <span className="t-meta flex-none text-warn">{f.note}</span>
        </button>
      ))}

      {faults.length > 4 && (
        <span className="t-meta pr-1 text-ink-faint">+{faults.length - 4} more</span>
      )}
    </div>
  );
}
