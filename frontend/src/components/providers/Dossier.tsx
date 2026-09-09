"use client";
import { Activity, ExternalLink, Info } from "lucide-react";
import {
  BILLING_LABEL,
  CAPABILITY_LABEL,
  HEALTH_INK,
  HEALTH_LABEL,
  RESIDENCE_LABEL,
} from "./catalog";
import { Chip, Monogram, ProbeTrace, ResidenceMark, Stamp } from "./atoms";
import { Btn, CredentialSeal } from "./CredentialSeal";
import { Block, CursorHandoff, ModelSection } from "./ModelSection";
import { specOf, useProviderStore } from "./providerStore";

/**
 * The dossier — everything known about one connection.
 *
 * Rhythm is deliberately different from the wallet next to it. The wallet is a
 * list you skim; this is a spec sheet you read. Header band spans the full
 * width and anchors identity; the body runs in a bounded measure so the prose
 * stays readable when the window is 2000px wide, rather than stretching into a
 * single unreadable line the way a naive flex-1 would.
 */

export function Dossier() {
  const { connections, selectedId, probe, attachSecret, revokeSecret, setEndpoint, toggleEnabled } =
    useProviderStore();
  const c = connections.find((x) => x.id === selectedId);
  if (!c) return null;
  const spec = specOf(c);

  const okProbes = c.probes.filter((p) => p.ok);
  const median = okProbes.length
    ? [...okProbes].sort((a, b) => a.ms - b.ms)[Math.floor(okProbes.length / 2)].ms
    : null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* ── Header band ──────────────────────────────────────────────────── */}
      <header className="flex-none border-b border-line bg-sub-100 px-5 pb-3 pt-4">
        <div className="flex items-start gap-3">
          <Monogram text={spec.monogram} live={c.health === "live"} size={30} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="t-display text-[20px] text-ink">{c.label}</h1>
              <span
                className="t-meta flex items-center gap-1.5 rounded-control border px-1.5 py-px"
                style={{
                  borderColor: HEALTH_INK[c.health],
                  color: HEALTH_INK[c.health],
                }}
              >
                <span
                  className="h-[5px] w-[5px] rounded-[1px]"
                  style={{ background: HEALTH_INK[c.health] }}
                  aria-hidden
                />
                {HEALTH_LABEL[c.health]}
              </span>
              {!c.enabled && <Chip>held out of runs</Chip>}
            </div>
            <p className="t-body mt-1 max-w-[76ch] text-ink-dim">{c.detail}</p>
          </div>

          <div className="flex flex-none gap-2">
            <Btn onClick={() => void probe(c.id)}>
              <Activity size={12} strokeWidth={1.7} />
              {c.health === "probing" ? "Testing…" : "Test"}
            </Btn>
            <Btn onClick={() => toggleEnabled(c.id)}>
              {c.enabled ? "Hold back" : "Put in service"}
            </Btn>
          </div>
        </div>

        {/* The three-axis strip. Four fixed columns in a recessed band, so two
            connections are compared by scanning one column rather than
            re-reading a paragraph. The band is inset rather than flat because
            it is a readout, not prose — the same move the status bar makes. */}
        <div className="-mx-5 mt-4 flex border-y border-line-soft bg-sub-200 px-5 py-2.5 [&>*:first-child]:border-l-0 [&>*:first-child]:pl-0">
          <Stamp
            kicker="runs on"
            value={RESIDENCE_LABEL[c.residence]}
            mark={<ResidenceMark residence={c.residence} />}
            note={
              c.residence === "local"
                ? "the prompt never leaves"
                : `${spec.vendor} infrastructure`
            }
          />
          <Stamp
            kicker="answers to"
            value={spec.capabilities.map((k) => CAPABILITY_LABEL[k]).join(" · ")}
            tone={spec.capabilities.includes("chat") ? "ink" : "warn"}
            note={
              spec.capabilities.includes("chat")
                ? "LLM nodes may target it"
                : "LLM nodes may not target it"
            }
          />
          <Stamp
            kicker="billed as"
            value={BILLING_LABEL[spec.billing]}
            tone={c.health === "degraded" ? "warn" : "ink"}
            note={billingNote(c)}
          />
          <Stamp
            kicker="reachability"
            value={median !== null ? `${median} ms median` : "never reached"}
            mark={<ProbeTrace probes={c.probes} health={c.health} height={11} />}
            tone={c.health === "fault" ? "fault" : "ink"}
            note={
              c.probes.length
                ? `${okProbes.length} of ${c.probes.length} probes answered`
                : "not yet tested"
            }
          />
        </div>
      </header>

      {/* ── Body ─────────────────────────────────────────────────────────── */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="max-w-[860px] px-5 pb-10">
          {spec.caveat && (
            <div
              className="mt-4 flex gap-2.5 rounded-control bg-sub-200 py-2.5 pl-2.5 pr-3"
              style={{ boxShadow: "inset 2px 0 0 0 var(--warn)" }}
            >
              <Info size={13} strokeWidth={1.8} className="mt-[2px] flex-none text-warn" />
              <p className="t-body max-w-[74ch] text-ink-dim">{spec.caveat}</p>
            </div>
          )}

          <p className="t-body mt-4 max-w-[74ch] text-ink-mute">{spec.summary}</p>

          <CredentialSeal
            connection={c}
            spec={spec}
            onAttach={(v) => attachSecret(c.id, v)}
            onRevoke={() => revokeSecret(c.id)}
          />

          {/* Endpoint sits below the credential, not above it: on a connection
              that needs setup the key is the only thing standing between the
              user and a working provider, and the endpoint is nearly always
              already correct. */}
          <Block
            title="Endpoint"
            chip={spec.endpoint.editable ? undefined : <Chip>fixed by vendor</Chip>}
          >
            <div className="flex items-center gap-2">
              <input
                value={c.endpoint}
                readOnly={!spec.endpoint.editable}
                onChange={(e) => setEndpoint(c.id, e.target.value)}
                spellCheck={false}
                className={[
                  "oh-focus-inner t-meta h-[27px] min-w-0 flex-1 rounded-control border border-line-soft bg-sub-200 px-2 outline-none",
                  spec.endpoint.editable
                    ? "text-ink focus:border-signal-deep"
                    : "cursor-default text-ink-mute",
                ].join(" ")}
              />
              <a
                href={spec.docs}
                target="_blank"
                rel="noreferrer"
                className="t-body inline-flex h-[27px] flex-none items-center gap-1.5 rounded-control border border-line bg-sub-200 px-2.5 text-ink-mute transition-colors hover:bg-sub-300 hover:text-ink"
              >
                Docs
                <ExternalLink size={11} strokeWidth={1.7} />
              </a>
            </div>
          </Block>

          {c.facts.length > 0 && (
            <Block
              title="Account"
              lede="Read back from the vendor on the last successful probe. Not stored, not cached."
            >
              <dl className="grid grid-cols-[128px_1fr] gap-x-4 gap-y-1.5 border-l border-line-soft pl-3">
                {c.facts.map((f) => (
                  <div key={f.k} className="contents">
                    <dt className="t-body text-ink-faint">{f.k}</dt>
                    <dd
                      className="t-meta truncate"
                      style={{
                        color:
                          f.tone === "warn"
                            ? "var(--warn)"
                            : f.tone === "fault"
                              ? "var(--fault)"
                              : f.tone === "signal"
                                ? "var(--signal)"
                                : "var(--ink-dim)",
                      }}
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
