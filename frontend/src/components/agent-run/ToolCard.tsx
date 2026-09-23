"use client";
import { useEffect, useState } from "react";
import { sendControl } from "./runClient";
import type { ToolCall } from "./types";
import { readDisclosure, useReadDisclosureStore, type DisclosureConnection } from "./readDisclosure";

/* ── Tool card (chat tools broker, contract v1.1 §2.5–2.6) ─────────────────
   The approval card is the last line of defence the threat-model names (T5,
   approval fatigue): argv one item per line so nothing hides in a long
   string, the sentence that says what "exec" really is, and a high-risk
   label that changes the card's colour — never a blocker, always legible. */

type Decision = "approve" | "reject";

function stateOf(call: ToolCall): { label: string; tone: "signal" | "ok" | "fault" | "warn" | "mute" } {
  if (call.denied) return call.denied.reason === "rejected" ? { label: "rejeitado", tone: "fault" } : { label: call.denied.reason === "approval_timeout" ? "sem resposta" : "bloqueado", tone: "fault" };
  if (call.simulated) return { label: "simulado", tone: "mute" };
  if (call.timedOut) return { label: "timeout", tone: "fault" };
  if (call.ok === false) return { label: "falhou", tone: "fault" };
  if (call.ok === true) return { label: "concluído", tone: "ok" };
  if (call.approval?.decision === "approve") return { label: "aprovado", tone: "signal" };
  if (call.approval?.decision === "reject") return { label: "rejeitado", tone: "fault" };
  if (call.approval) return { label: "aguardando aprovação", tone: "warn" };
  return { label: "executando", tone: "signal" };
}

const TONE: Record<string, string> = {
  signal: "var(--signal)", ok: "var(--ok, var(--ink-mute))", fault: "var(--fault)", warn: "var(--warn)", mute: "var(--ink-faint)",
};

export function ToolCard({ call, runId, connection }: { call: ToolCall; runId: string | null; connection?: DisclosureConnection | null }) {
  const [sent, setSent] = useState<Decision | null>(null);
  const [note, setNote] = useState("");
  const [open, setOpen] = useState(false);
  // First read result on a remote provider: this card claims the disclosure
  // for the session, later cards for the same provider see it as already said.
  const disclosure = readDisclosure(connection, call);
  const alreadyDisclosed = useReadDisclosureStore((s) => Boolean(connection && s.seen.includes(connection.provider)));
  const [claimedDisclosure, setClaimedDisclosure] = useState(() => disclosure != null && !alreadyDisclosed);
  useEffect(() => {
    if (!disclosure || claimedDisclosure || alreadyDisclosed || !connection) return;
    useReadDisclosureStore.getState().markDisclosed(connection.provider);
    setClaimedDisclosure(true);
  }, [alreadyDisclosed, claimedDisclosure, connection, disclosure]);
  useEffect(() => {
    if (claimedDisclosure && connection) useReadDisclosureStore.getState().markDisclosed(connection.provider);
  }, [claimedDisclosure, connection]);
  const pendingApproval = Boolean(call.approval) && !call.approval?.decision && !call.denied;
  const high = call.approval?.risk === "high";
  const state = stateOf(call);
  const title = call.name === "exec" || call.name === "run_command" ? "Executar comando" : call.name === "read" || call.name === "read_file" ? "Ler arquivo" : call.name === "discover" || call.name === "list_workspace" ? "Listar workspace" : call.name;

  const decide = (decision: Decision) => {
    if (sent || !runId || !pendingApproval) return;
    setSent(decision);
    void sendControl(runId, { action: "resume", decision, call_id: call.callId, note });
  };

  return (
    <div
      className="mt-2 rounded-panel border bg-sub-200 p-3"
      style={{ borderColor: high ? "var(--fault)" : pendingApproval ? "var(--warn)" : "var(--line-soft)" }}
      data-tool-card={call.callId}
    >
      <div className="flex items-center gap-2">
        <span className="t-meta text-ink">{title}</span>
        {call.origin && <span className="t-meta text-ink-faint">· {call.origin === "model" ? "pedido pelo modelo" : "pedido por você"}</span>}
        {high && <span className="rounded-control px-1.5 py-0.5 text-[10px] font-[600] uppercase" style={{ background: "var(--fault)", color: "var(--signal-ink, #fff)" }}>alto risco</span>}
        <span className="flex-1" />
        <span className="t-meta" style={{ color: TONE[state.tone] }}>{state.label}</span>
      </div>

      {call.argv ? (
        <ol className="mt-2 rounded-control bg-sub-100 px-3 py-2 font-mono text-[12px] leading-5 text-ink" aria-label="argv">
          {call.argv.map((a, i) => <li key={i} className="whitespace-pre-wrap break-all">{a}</li>)}
        </ol>
      ) : call.path ? (
        <p className="mt-2 rounded-control bg-sub-100 px-3 py-2 font-mono text-[12px] text-ink">{call.path}</p>
      ) : null}

      {high && call.approval?.riskHints.length ? (
        <p className="mt-1.5 text-[12px] text-ink-mute">
          Padrão de risco: {call.approval.riskHints.map((h) => <code key={h} data-hint className="mr-1 rounded bg-sub-100 px-1">{h}</code>)}
        </p>
      ) : null}

      {call.approval && (
        <p className="mt-1.5 text-[12px] text-ink-mute">
          {call.approval.reason === "secret_pattern"
            ? "Este caminho parece conter segredos. Só será lido se você aprovar."
            : "Isto é execução local, com os seus privilégios — não há sandbox de sistema. Só roda se você aprovar."}
        </p>
      )}

      {pendingApproval && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button type="button" disabled={Boolean(sent) || !runId} onClick={() => decide("approve")}
            className="h-8 rounded-[8px] bg-signal px-3 text-[12px] font-[550] text-signal-ink disabled:opacity-40">Aprovar</button>
          <button type="button" disabled={Boolean(sent) || !runId} onClick={() => decide("reject")}
            className="h-8 rounded-control border border-line px-3 text-[12px] font-[550] text-ink disabled:opacity-40">Rejeitar</button>
          <input value={note} onChange={(e) => setNote(e.target.value)} disabled={Boolean(sent)} placeholder="nota (opcional, fica no histórico)"
            aria-label="Nota da decisão" className="h-8 min-w-0 flex-1 rounded-control border border-line-soft bg-sub-100 px-2 text-[12px] text-ink" />
          {sent && <span className="t-meta text-ink-faint">enviando…</span>}
        </div>
      )}

      {call.approval?.decision && call.approval.note ? <p className="mt-1 text-[11px] text-ink-faint">nota: {call.approval.note}</p> : null}
      {call.denied?.note ? <p className="mt-1 text-[11px] text-ink-faint">{call.denied.note}</p> : null}
      {claimedDisclosure && disclosure ? (
        <p className="mt-1.5 text-[12px] text-ink-mute" data-read-disclosure>{disclosure}</p>
      ) : null}

      {(call.result || call.truncated || typeof call.exitCode === "number") && (
        <div className="mt-2">
          <div className="flex items-center gap-2 text-[11px] text-ink-faint">
            {typeof call.exitCode === "number" && <span>exit {call.exitCode}</span>}
            {call.truncated && <span style={{ color: "var(--warn)" }}>saída truncada</span>}
            {call.redactions ? <span>{call.redactions} segredo{call.redactions > 1 ? "s" : ""} redigido{call.redactions > 1 ? "s" : ""}</span> : null}
            {call.result && call.result.length > 240 && (
              <button type="button" onClick={() => setOpen((v) => !v)} className="text-ink-mute hover:text-ink">{open ? "recolher" : "expandir"}</button>
            )}
          </div>
          {call.result && (
            <pre className={"mt-1 overflow-x-auto rounded-control bg-sub-100 px-3 py-2 font-mono text-[12px] leading-5 text-ink " + (open ? "" : "max-h-40 overflow-y-hidden")}>{call.result}</pre>
          )}
        </div>
      )}
    </div>
  );
}
