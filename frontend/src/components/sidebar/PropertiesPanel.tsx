"use client";
import { useCanvasStore } from "@/store/canvasStore";
import { Panel } from "@/components/shell/Panel";
import { chordCaps, useIsMac } from "@/components/shell/keys";
import { ROLE_CODE, ROLE_ICON, ROLE_VAR } from "@/lib/roles";
import { PORTS } from "@/lib/ports";
import type { NodeData, AdapterType, NodeType } from "@/lib/types";
import { PROVIDERS_BIND_NONE } from "@/components/providers/copy";
import { useProviderStore } from "@/components/providers/providerStore";

/* ═══════════════════════════════════════════════════════════════════════════
   The inspector.

   Same fields as before; the change is that they are now under section
   kickers that match the palette's, and the panel opens with two things the
   old one never showed: an identity block that tells you *what kind of thing*
   you selected, and the node's live port table with wired state. Editing a
   node's model without being able to see what it is connected to is how you
   end up debugging a graph in the JSON export.
   ═══════════════════════════════════════════════════════════════════════════ */

const ADAPTERS: AdapterType[] = ["mock", "claude", "ollama", "openai", "lmstudio", "codex"];

const inputCls =
  "w-full rounded-control border border-line-soft bg-sub-200 px-2 py-1 text-title text-ink outline-none transition-colors hover:border-line focus:border-signal";
const textareaCls = `${inputCls} h-[76px] resize-none text-body leading-relaxed`;

function SectionHead({ label, note }: { label: string; note?: string }) {
  return (
    <div className="flex h-panelhead items-baseline gap-2 border-y border-line-soft bg-sub-000 px-2.5">
      <span className="t-label flex-none text-ink-dim">{label}</span>
      {note && <span className="t-body min-w-0 flex-1 truncate text-ink-faint">{note}</span>}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="t-label block text-ink-faint">{label}</label>
      {children}
    </div>
  );
}

/** The node's wiring, read straight off the graph. */
function PortTable({ nodeId, type }: { nodeId: string; type: NodeType }) {
  const edges = useCanvasStore((s) => s.edges);
  const nodes = useCanvasStore((s) => s.nodes);
  const nameOf = (id: string) => String(nodes.find((n) => n.id === id)?.data.label ?? id);

  const rows = [
    ...PORTS[type].in.map((p) => {
      const wires = edges.filter((e) => e.target === nodeId && (e.targetHandle ?? "in") === p.id);
      return { key: `in-${p.id}`, dir: "in" as const, port: p, wires };
    }),
    ...PORTS[type].out.map((p) => {
      const wires = edges.filter((e) => e.source === nodeId && (e.sourceHandle ?? "out") === p.id);
      return { key: `out-${p.id}`, dir: "out" as const, port: p, wires };
    }),
  ];

  return (
    <div className="px-2.5 py-2">
      {rows.map((r) => {
        const tone =
          r.port.tone === "accept"
            ? "var(--signal-deep)"
            : r.port.tone === "reject"
              ? "var(--fault)"
              : "var(--ink-mute)";
        const wired = r.wires.length > 0;
        return (
          <div key={r.key} className="flex items-center gap-2 py-[3px]">
            <span
              aria-hidden
              className="h-[10px] w-[3px] flex-none rounded-[1px]"
              style={{
                background: wired ? tone : "transparent",
                boxShadow: wired ? "none" : `inset 0 0 0 1px var(--line)`,
              }}
            />
            <span className="t-meta w-[24px] flex-none text-ink-faint">{r.dir}</span>
            <span className="t-meta w-[56px] flex-none truncate" style={{ color: tone }}>
              {r.port.label}
            </span>
            <span className="t-body min-w-0 flex-1 truncate text-right text-ink-mute">
              {wired ? r.wires.map((w) => nameOf(r.dir === "in" ? w.source : w.target)).join(", ") : "—"}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export function PropertiesPanel() {
  const nodes = useCanvasStore((s) => s.nodes);
  const selectedNodeId = useCanvasStore((s) => s.selectedNodeId);
  const updateNodeData = useCanvasStore((s) => s.updateNodeData);
  const connections = useProviderStore((s) => s.connections);
  const mac = useIsMac();
  const node = nodes.find((n) => n.id === selectedNodeId);

  if (!node) {
    return (
      <Panel title="Inspector" className="h-full">
        <div className="flex h-full flex-col items-center justify-center gap-2 px-6">
          <p className="t-body text-center text-ink-mute">No node selected</p>
          <p className="t-meta flex items-center gap-1.5 text-ink-faint">
            click a node, or
            {chordCaps("Mod+K", mac).map((c) => (
              <kbd key={c} className="oh-kbd">
                {c}
              </kbd>
            ))}
          </p>
        </div>
      </Panel>
    );
  }

  const type = node.type as NodeType;
  const Icon = ROLE_ICON[type];
  const role = ROLE_VAR[type];
  const d = node.data as NodeData;
  const update = (patch: Partial<NodeData>) => updateNodeData(node.id, patch);
  const isModel = ["llm", "evaluator", "tool", "aggregator"].includes(node.type);
  const sealed = connections.filter((c) => c.secret);

  return (
    <Panel
      title="Inspector"
      meta={ROLE_CODE[type]}
      className="h-full"
      actions={
        <span
          className="ml-1 h-[12px] w-[2px] rounded-[1px]"
          style={{ background: role }}
          aria-hidden
        />
      }
    >
      {/* ── Identity ─────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2.5 px-2.5 py-2.5">
        <span
          aria-hidden
          className="grid h-[22px] w-[22px] flex-none place-items-center rounded-[2px]"
          style={{
            background: "color-mix(in oklab, var(--role-c) 18%, var(--sub-200))",
            ["--role-c" as string]: role,
            color: role,
          }}
        >
          <Icon size={13} strokeWidth={1.8} absoluteStrokeWidth />
        </span>
        <div className="min-w-0 flex-1">
          <div className="t-title truncate text-ink">{String(d.label ?? node.id)}</div>
          <div className="t-meta truncate text-ink-faint">{node.id}</div>
        </div>
      </div>

      <SectionHead label="Wiring" note={`${PORTS[type].in.length} in · ${PORTS[type].out.length} out`} />
      <PortTable nodeId={node.id} type={type} />

      <SectionHead label="Settings" />
      <div className="space-y-3.5 p-2.5">
        <Field label="Label">
          <input
            className={inputCls}
            value={d.label ?? ""}
            onChange={(e) => update({ label: e.target.value })}
          />
        </Field>

        {node.type === "input" && (
          <Field label="Prompt">
            <textarea
              className={textareaCls}
              value={d.prompt ?? ""}
              onChange={(e) => update({ prompt: e.target.value })}
              placeholder="Enter the initial prompt..."
            />
          </Field>
        )}

        {node.type === "router" && (
          <Field label="Condition">
            <input
              className={`${inputCls} font-mono text-meta`}
              value={d.condition ?? ""}
              onChange={(e) => update({ condition: e.target.value })}
              placeholder="output.includes('PASS')"
            />
          </Field>
        )}

        {node.type === "hitl" && (
          <Field label="Approval Label">
            <input
              className={inputCls}
              value={d.approvalLabel ?? ""}
              onChange={(e) => update({ approvalLabel: e.target.value })}
            />
          </Field>
        )}
      </div>

      {isModel && (
        <>
          <SectionHead label="Provider" note="runs against your own subscription" />
          <div className="space-y-3.5 p-2.5">
            <Field label="Adapter">
              <select
                className={inputCls}
                value={d.adapter ?? "mock"}
                onChange={(e) => update({ adapter: e.target.value as AdapterType })}
              >
                {ADAPTERS.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Model">
              <input
                className={inputCls}
                value={d.model ?? ""}
                onChange={(e) => update({ model: e.target.value })}
                placeholder="e.g. gpt-4o, claude-sonnet-4, llama3.2"
              />
            </Field>

            {(d.adapter === "ollama" || d.adapter === "lmstudio") && (
              <Field label="Endpoint">
                <input
                  className={inputCls}
                  value={d.endpoint ?? ""}
                  onChange={(e) => update({ endpoint: e.target.value })}
                  placeholder="http://localhost:11434/v1"
                />
              </Field>
            )}

            {d.adapter !== "mock" && (
              <Field label="Credential">
                <select
                  className={inputCls}
                  value={d.secretRef ?? ""}
                  onChange={(e) => {
                    const secretRef = e.target.value || undefined;
                    // Drop any legacy plaintext apiKey when binding a vault ref.
                    update({ secretRef, apiKey: undefined });
                  }}
                >
                  <option value="">{PROVIDERS_BIND_NONE}</option>
                  {sealed.map((c) => (
                    <option key={c.id} value={c.secret!.service}>
                      {c.label} · {c.secret!.prefix}…{c.secret!.tail}
                    </option>
                  ))}
                </select>
                {sealed.length === 0 && (
                  <p className="t-meta mt-1 text-ink-faint">
                    Seal a key under Providers (Alt+4). The inspector only stores the reference.
                  </p>
                )}
              </Field>
            )}

            <Field label="System Prompt">
              <textarea
                className={textareaCls}
                value={d.systemPrompt ?? ""}
                onChange={(e) => update({ systemPrompt: e.target.value })}
                placeholder="You are a helpful assistant..."
              />
            </Field>

            <Field label={`Temperature — ${d.temperature ?? 0.7}`}>
              <input
                type="range"
                min={0}
                max={2}
                step={0.1}
                value={d.temperature ?? 0.7}
                onChange={(e) => update({ temperature: parseFloat(e.target.value) })}
                className="w-full"
              />
            </Field>

            <Field label="Max Tokens">
              <input
                className={inputCls}
                type="number"
                value={d.maxTokens ?? 4096}
                onChange={(e) => update({ maxTokens: parseInt(e.target.value) })}
              />
            </Field>
          </div>
        </>
      )}

      {d.status && d.status !== "idle" && (
        <>
          <SectionHead label="Last run" />
          <div className="space-y-1 p-2.5">
            <div className="t-meta flex justify-between text-ink-faint">
              status <span className="text-signal">{d.status}</span>
            </div>
            {d.tokens !== undefined && (
              <div className="t-meta flex justify-between text-ink-faint">
                tokens <span className="text-ink-dim">{d.tokens}</span>
              </div>
            )}
            {d.latencyMs !== undefined && (
              <div className="t-meta flex justify-between text-ink-faint">
                latency <span className="text-ink-dim">{d.latencyMs}ms</span>
              </div>
            )}
            {d.output && (
              <pre className="t-meta oh-inset mt-2 max-h-[160px] overflow-auto whitespace-pre-wrap break-all p-2 text-ink-dim">
                {d.output}
              </pre>
            )}
            {d.error && <div className="t-meta pt-1 text-fault">{d.error}</div>}
          </div>
        </>
      )}
    </Panel>
  );
}
