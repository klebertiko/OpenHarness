"use client";
import { GripVertical, CornerDownRight } from "lucide-react";
import {
  NODE_TEMPLATES,
  HARNESS_PRESETS,
  STAGE_ORDER,
  STAGE_LABEL,
  STAGE_NOTE,
} from "@/lib/templates";
import { ROLE_CODE, ROLE_ICON, ROLE_VAR } from "@/lib/roles";
import { PORTS } from "@/lib/ports";
import { useCanvasStore } from "@/store/canvasStore";
import { Panel } from "@/components/shell/Panel";
import type { HarnessNode, HarnessEdge, NodeTemplate, NodeType } from "@/lib/types";

/* ═══════════════════════════════════════════════════════════════════════════
   The palette.

   Two changes carry it. First, the nine types are grouped into the four stages
   a harness has — boundary, compute, control, state — with a one-line gloss
   per group, so the panel teaches the model instead of just listing parts.
   Second, every row wears the same 3px role spine and glyph chip as the plate
   it produces, and states its port shape in mono. Dragging a row should feel
   like dragging the thing itself, not like picking from a menu.
   ═══════════════════════════════════════════════════════════════════════════ */

/** "1 in · 2 out" — the fact that decides whether a node can go where you want. */
function portShape(type: NodeType) {
  const { in: i, out: o } = PORTS[type];
  return `${i.length}→${o.length}`;
}

function TemplateRow({ template }: { template: NodeTemplate }) {
  const type = template.type as NodeType;
  const Icon = ROLE_ICON[type];
  const role = ROLE_VAR[type];

  const onDragStart = (e: React.DragEvent) => {
    e.dataTransfer.setData("application/harness-node", JSON.stringify(template));
    e.dataTransfer.effectAllowed = "copy";
  };

  return (
    <div
      draggable
      tabIndex={0}
      onDragStart={onDragStart}
      title={`Drag onto the bench — ${template.description}`}
      className="group relative flex cursor-grab items-start gap-2 border-b border-line-soft py-[7px] pl-[11px] pr-2 transition-colors last:border-b-0 hover:bg-sub-200 active:cursor-grabbing"
    >
      <span
        aria-hidden
        className="absolute inset-y-[6px] left-0 w-[3px] rounded-[1px] opacity-70 transition-opacity group-hover:opacity-100"
        style={{ background: role }}
      />
      <span
        aria-hidden
        className="mt-[1px] grid h-[16px] w-[16px] flex-none place-items-center rounded-[2px]"
        style={{
          background: "color-mix(in oklab, var(--role-c) 16%, var(--sub-200))",
          ["--role-c" as string]: role,
          color: role,
        }}
      >
        <Icon size={10} strokeWidth={1.9} absoluteStrokeWidth />
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="t-title min-w-0 flex-1 truncate text-ink">{template.label}</span>
          <span className="t-meta flex-none text-ink-faint">{portShape(type)}</span>
        </div>
        <div className="t-body line-clamp-2 text-ink-mute">{template.description}</div>
      </div>

      <GripVertical
        size={12}
        strokeWidth={1.6}
        absoluteStrokeWidth
        aria-hidden
        className="mt-[2px] flex-none text-ink-faint opacity-0 transition-opacity group-hover:opacity-100"
      />
    </div>
  );
}

function SectionHead({ label, note }: { label: string; note: string }) {
  return (
    <div className="flex h-panelhead items-baseline gap-2 border-b border-line-soft bg-sub-000 px-2.5">
      <span className="t-label flex-none text-ink-dim">{label}</span>
      <span className="t-body min-w-0 flex-1 truncate text-ink-faint">{note}</span>
    </div>
  );
}

export function NodePalette() {
  const loadGraph = useCanvasStore((s) => s.loadGraph);
  const setHarnessMeta = useCanvasStore((s) => s.setHarnessMeta);

  const loadPreset = (preset: (typeof HARNESS_PRESETS)[number]) => {
    loadGraph(preset.graph.nodes as HarnessNode[], preset.graph.edges as HarnessEdge[]);
    setHarnessMeta({ id: null, name: preset.name, description: preset.description });
  };

  return (
    <Panel title="Nodes" meta={`${NODE_TEMPLATES.length} types`} className="h-full">
      {STAGE_ORDER.map((stage) => {
        const rows = NODE_TEMPLATES.filter((t) => t.stage === stage);
        if (rows.length === 0) return null;
        return (
          <section key={stage}>
            <SectionHead label={STAGE_LABEL[stage]} note={STAGE_NOTE[stage]} />
            {rows.map((t) => (
              <TemplateRow key={t.type} template={t} />
            ))}
          </section>
        );
      })}

      <section>
        <SectionHead label="Presets" note="whole graphs, ready to run" />
        {HARNESS_PRESETS.map((p) => (
          <button
            key={p.id}
            onClick={() => loadPreset(p)}
            className="group flex w-full items-start gap-2 border-b border-line-soft py-[7px] pl-[11px] pr-2 text-left transition-colors last:border-b-0 hover:bg-sub-200"
          >
            <CornerDownRight
              size={11}
              strokeWidth={1.6}
              absoluteStrokeWidth
              aria-hidden
              className="mt-[3px] flex-none text-ink-faint transition-colors group-hover:text-signal"
            />
            <span className="min-w-0 flex-1">
              <span className="flex items-baseline gap-2">
                <span className="t-title min-w-0 flex-1 truncate text-ink-dim group-hover:text-ink">
                  {p.name}
                </span>
                <span className="t-meta flex-none text-ink-faint">
                  {p.graph.nodes.length}n·{p.graph.edges.length}e
                </span>
              </span>
              <span className="t-body line-clamp-2 text-ink-faint">{p.description}</span>
              {/* The role hues in this preset, in graph order — a two-second
                  read of what the harness is made of before you load it. */}
              <span className="mt-[5px] flex gap-[3px]" aria-hidden>
                {p.graph.nodes.map((n) => (
                  <span
                    key={n.id}
                    title={ROLE_CODE[n.type as NodeType]}
                    className="h-[3px] flex-1 rounded-[1px] opacity-65 transition-opacity group-hover:opacity-100"
                    style={{ background: ROLE_VAR[n.type as NodeType] }}
                  />
                ))}
              </span>
            </span>
          </button>
        ))}
      </section>
    </Panel>
  );
}
