"use client";
import { useEffect } from "react";
import { Activity, ExternalLink, Info } from "lucide-react";
import { providerReadiness } from "@/components/agent/chatProvider";
import { type ConnectionUsage } from "@/lib/usageApi";
import { BILLING_LABEL, CAPABILITY_LABEL, RESIDENCE_LABEL } from "./catalog";
import { Chip, Fact, Monogram, ProbeTrace, ResidenceMark, TONE_TEXT, ToneDot } from "./atoms";
import { Btn, CredentialSeal } from "./CredentialSeal";
import { Block, CursorHandoff, ModelSection } from "./ModelSection";
import { nextStep } from "./nextStep";
import { specOf, useProviderStore } from "./providerStore";
import { usageCostLabel, useUsageStore } from "./usageStore";

/* Hallmark · genre: modern-minimal editorial workspace
   macrostructure: Curated Library · design-system: design.md · designed-as-app
   No mascot here by design — a spec sheet you read, not a moment to welcome. */
/**
 * The dossier — everything known about one connection.
 *
 * Reading order is the hierarchy: who it is and whether it answers (header),
 * the one thing that would make it answer (a single primary button, only
 * when something is missing), then the spec sheet, then the detail blocks.
 * Status is read only through `providerReadiness` (chatProvider.ts), so this
 * header, the list on the left and the chat picker never disagree.
 *
 * Width is never assumed: the header wraps its actions under the name, the
 * facts reflow from one to five columns, and below the shell's 640px
 * breakpoint — where the list on the left is suppressed — a native provider
 * switcher takes its place so the screen is never a dead end.
 */

/** This connection's spend, read honestly: "free" only for a genuinely
    local/on-device connection, "cost unknown" for a cloud one this catalog
    has no price for, "—" when it has simply never been used. */
function spendFact(usage: ConnectionUsage | undefined) {
  if (!usage || usage.tokensTotal <= 0) {
    return { value: "—", note: "no usage recorded yet", tone: "ink" as const };
  }
  const value = usageCostLabel(usage);
  const note = `${usage.tokensTotal.toLocaleString()} tokens`;
  const tone = value === "cost unknown" ? ("warn" as const) : ("ink" as const);
  return { value, note, tone };
}

/** Stand-in for the left list when the window is too narrow to show it
    (the shell hides the left panel under 640px — AppShell's narrow policy). */
function ProviderSwitcher() {
  const { connections, selectedId, select } = useProviderStore();
  if (!connections.length) return null;
  const known = connections.some((c) => c.id === selectedId);
  return (
    <label className="mb-3 flex items-center gap-2 sm:hidden">
      <span className="t-body flex-none text-ink-mute">Provider</span>
      <select
        value={known ? selectedId : ""}
        onChange={(e) => select(e.target.value)}
        className="t-body h-8 min-w-0 flex-1 rounded-control border border-line bg-sub-200 px-2 text-ink outline-none focus-visible:border-signal-deep focus-visible:outline focus-visible:outline-2 focus-visible:outline-signal"
      >
        {!known && (
          <option value="" disabled>
            Choose a provider
          </option>
        )}
        {connections.map((c) => (
          <option key={c.id} value={c.id}>
            {`${c.label} — ${providerReadiness(c).label}`}
          </option>
        ))}
      </select>
    </label>
  );
}

const CRED_INPUT_ID = "oh-cred";

export function Dossier() {
  const { connections, selectedId, probe, attachSecret, revokeSecret, setEndpoint, toggleEnabled } =
    useProviderStore();
  const hydrateUsage = useUsageStore((s) => s.hydrate);
  const usageByConnection = useUsageStore((s) => s.summary?.byConnection);
  useEffect(() => {
    void hydrateUsage();
  }, [hydrateUsage]);

  const c = connections.find((x) => x.id === selectedId);
  if (!c) {
    return (
      <div className="flex h-full flex-col px-4 pt-4 sm:px-6">
        <ProviderSwitcher />
        <div className="flex flex-1 flex-col items-center justify-center gap-1 text-center">
          <p className="t-title text-ink">
            Pick a provider<span className="hidden sm:inline"> on the left</span>.
          </p>
          <p className="t-body max-w-[260px] text-ink-mute">Its connection, models and health live here.</p>
        </div>
      </div>
    );
  }

  const spec = specOf(c);
  const readiness = providerReadiness(c);
  const ready = readiness.ready;
  const step = nextStep(c);
  // The store's detail often opens by restating the status word ("Not
  // connected. Add a key…"); the status line above already says it.
  const detail = c.detail.startsWith(`${readiness.label}.`)
    ? c.detail.slice(readiness.label.length + 1).trim()
    : c.detail;
  const probing = c.health === "probing";
  const usage = usageByConnection?.find((u) => u.connectionId === c.id);
  const spend = spendFact(usage);

  const okProbes = c.probes.filter((p) => p.ok);
  const median = okProbes.length
    ? [...okProbes].sort((a, b) => a.ms - b.ms)[Math.floor(okProbes.length / 2)].ms
    : null;

  const turnOnThenTest = () => {
    // Turn on, then test — one flow, the same promise the chat combo's inline
    // setup makes (design.md § Provider stance).
    void toggleEnabled(c.id).then(() => probe(c.id));
  };

  const runStep = () => {
    if (!step) return;
    if (step.kind === "paste") {
      const field = document.getElementById(CRED_INPUT_ID);
      field?.scrollIntoView({ block: "center", behavior: "smooth" });
      field?.focus({ preventScroll: true });
    } else if (step.kind === "turnOn") {
      turnOnThenTest();
    } else {
      void probe(c.id);
    }
  };

  const seal = (
    <CredentialSeal
      connection={c}
      spec={spec}
      onAttach={(v) => attachSecret(c.id, v)}
      onRevoke={() => revokeSecret(c.id)}
    />
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* ── Identity, status, the one action ─────────────────────────────── */}
      <header className="flex-none border-b border-line bg-sub-100 px-4 pb-4 pt-4 sm:px-6">
        <ProviderSwitcher />
        <div className="flex flex-wrap items-start gap-x-6 gap-y-3">
          <div className="flex min-w-0 flex-[1_1_16rem] items-start gap-3">
            <Monogram text={spec.monogram} live={readiness.verified} size="lg" />
            <div className="min-w-0">
              <h1 className="t-display text-[20px] text-ink [overflow-wrap:anywhere]">{c.label}</h1>
              <p className="t-body mt-1 flex items-center gap-1.5" aria-live="polite">
                <ToneDot tone={readiness.tone} />
                <span className={`font-medium ${TONE_TEXT[readiness.tone]}`}>{readiness.label}</span>
              </p>
              {detail && <p className="t-body mt-1 max-w-[68ch] text-ink-dim">{detail}</p>}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {step && (
              <Btn primary onClick={runStep} disabled={probing}>
                {step.kind === "retest" && <Activity size={12} strokeWidth={1.7} aria-hidden />}
                {step.kind === "retest" && probing ? "Testing…" : step.label}
              </Btn>
            )}
            {!step && (
              <Btn onClick={() => void probe(c.id)} disabled={probing}>
                <Activity size={12} strokeWidth={1.7} aria-hidden />
                {probing ? "Testing…" : "Test"}
              </Btn>
            )}
            {c.enabled && <Btn onClick={() => void toggleEnabled(c.id)}>Turn off</Btn>}
          </div>
        </div>
      </header>

      {/* ── Body ─────────────────────────────────────────────────────────── */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="max-w-[880px] px-4 pb-10 [container-type:inline-size] sm:px-6">
          {/* A not-ready connection leads with the block that makes it ready;
              once it is ready, the same block moves below the spec sheet —
              nobody needs connect instructions for a provider they use daily. */}
          {!ready && seal}

          <dl className="mt-4 grid grid-cols-[repeat(auto-fill,minmax(min(100%,8.5rem),1fr))] gap-x-5 gap-y-3">
            <Fact
              term="Runs on"
              value={RESIDENCE_LABEL[c.residence]}
              mark={<ResidenceMark residence={c.residence} />}
              note={c.residence === "local" ? "the prompt never leaves" : `${spec.vendor} infrastructure`}
            />
            <Fact
              term="Answers to"
              value={spec.capabilities.map((k) => CAPABILITY_LABEL[k]).join(" · ")}
              tone={spec.capabilities.includes("chat") ? "ink" : "warn"}
              note={spec.capabilities.includes("chat") ? "LLM nodes may target it" : "LLM nodes may not target it"}
            />
            <Fact
              term="Billed as"
              value={BILLING_LABEL[spec.billing]}
              tone={readiness.tone === "attention" ? "warn" : "ink"}
              note={
                spec.credential.kind === "api-key"
                  ? c.secret
                    ? "key on file"
                    : "no key yet"
                  : spec.credential.kind === "cli"
                    ? "your CLI login"
                    : "no credential needed"
              }
            />
            <Fact
              term="Reachability"
              value={median !== null ? `${median} ms median` : "never reached"}
              mark={<ProbeTrace probes={c.probes} tone={readiness.tone} />}
              tone={readiness.state === "fault" ? "fault" : "ink"}
              note={
                c.probes.length ? `${okProbes.length} of ${c.probes.length} probes answered` : "not yet tested"
              }
            />
            <Fact term="Spent" value={spend.value} tone={spend.tone} note={spend.note} />
          </dl>

          {spec.caveat && (
            <div className="mt-5 flex gap-2.5 rounded-control border-l-2 border-warn bg-sub-200 py-2.5 pl-2.5 pr-3">
              <Info size={13} strokeWidth={1.8} className="mt-[2px] flex-none text-warn" aria-hidden />
              <p className="t-body max-w-[70ch] text-ink-dim">{spec.caveat}</p>
            </div>
          )}

          <p className="t-body mt-4 max-w-[70ch] text-ink-mute">{spec.summary}</p>

          {ready && <div className="mt-4">{seal}</div>}

          {/* Endpoint sits below the credential: on a connection that needs
              setup the key is the only thing standing between the user and a
              working provider, and the endpoint is nearly always correct. */}
          <Block title="Endpoint" chip={spec.endpoint.editable ? undefined : <Chip>fixed by vendor</Chip>}>
            <div className="flex flex-wrap items-center gap-2">
              <input
                aria-label={`${c.label} endpoint`}
                value={c.endpoint}
                readOnly={!spec.endpoint.editable}
                onChange={(e) => setEndpoint(c.id, e.target.value)}
                spellCheck={false}
                className={[
                  "oh-focus-inner t-meta h-8 min-w-0 flex-[1_1_12rem] rounded-control border border-line-soft bg-sub-200 px-2 outline-none",
                  spec.endpoint.editable ? "text-ink focus:border-signal-deep" : "cursor-default text-ink-mute",
                ].join(" ")}
              />
              <a
                href={spec.docs}
                target="_blank"
                rel="noreferrer"
                className="t-body inline-flex h-8 flex-none items-center gap-1.5 rounded-control border border-line bg-sub-200 px-2.5 text-ink-mute transition-colors hover:bg-sub-300 hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-signal"
              >
                {spec.vendor} docs
                <ExternalLink size={11} strokeWidth={1.7} aria-hidden />
              </a>
            </div>
          </Block>

          <Block
            title="Usage"
            lede="Recorded usage for this connection. Measured and estimated tokens are not separated in this summary; costs are estimates, not invoices."
          >
            {!usage || usage.tokensTotal <= 0 ? (
              <p className="t-body text-ink-faint">No usage recorded on this connection yet.</p>
            ) : (
              <dl className="grid grid-cols-[minmax(0,7rem)_minmax(0,1fr)] gap-x-4 gap-y-1.5 border-l border-line-soft pl-3">
                <dt className="t-body text-ink-faint">Tokens</dt>
                <dd className="t-meta text-ink-dim">{usage.tokensTotal.toLocaleString()}</dd>
                {usage.unpricedTokens > 0 && c.residence !== "local" && (
                  <>
                    <dt className="t-body text-ink-faint">Unpriced</dt>
                    <dd className="t-meta text-warn">
                      {usage.unpricedTokens.toLocaleString()} tokens billed at an unknown rate — not included
                      in the spend above, so it may understate real spend
                    </dd>
                  </>
                )}
              </dl>
            )}
          </Block>

          {c.facts.length > 0 && (
            <Block title="Account" lede="Read back from the vendor on the last successful probe. Not stored, not cached.">
              <dl className="grid grid-cols-[minmax(0,7rem)_minmax(0,1fr)] gap-x-4 gap-y-1.5 border-l border-line-soft pl-3">
                {c.facts.map((f) => (
                  <div key={f.k} className="contents">
                    <dt className="t-body text-ink-faint">{f.k}</dt>
                    <dd
                      className={[
                        "t-meta [overflow-wrap:anywhere]",
                        f.tone === "warn"
                          ? "text-warn"
                          : f.tone === "fault"
                            ? "text-fault"
                            : f.tone === "signal"
                              ? "text-signal"
                              : "text-ink-dim",
                      ].join(" ")}
                    >
                      {f.v}
                    </dd>
                  </div>
                ))}
              </dl>
            </Block>
          )}

          {spec.catalogue === "agent-only" ? <CursorHandoff c={c} /> : <ModelSection c={c} />}
        </div>
      </div>
    </div>
  );
}
