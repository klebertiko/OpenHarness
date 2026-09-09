"use client";
import { ArrowDown, ArrowUp, Minus, Plus, TriangleAlert } from "lucide-react";
import { HEALTH_INK, HEALTH_LABEL } from "./catalog";
import { Monogram, ResidenceMark, StateRule } from "./atoms";
import { specOf, useProviderStore } from "./providerStore";

/**
 * Which connections this harness is allowed to spend, and in what order.
 *
 * A binding is not a checkbox list. Order is the whole content: step 1 is where
 * every node goes first, and each step below it is what happens when the one
 * above refuses — rate limit, outage, exhausted credits. Reading the chain top
 * to bottom tells you the run's worst case before you press play.
 *
 * The egress line under the chain exists because in a mixed local/cloud wallet
 * the fallback is the thing that quietly breaks your assumptions: a graph you
 * believe is running on-device will hop to a vendor the moment the daemon
 * stalls, and nothing else in the app would have told you.
 */

export function RunBinding() {
  const { connections, binding, bindToggle, bindMove, select, selectedId } = useProviderStore();

  const bound = binding
    .map((id) => connections.find((c) => c.id === id))
    .filter((c): c is NonNullable<typeof c> => Boolean(c));
  const rest = connections.filter(
    (c) => !binding.includes(c.id) && specOf(c).capabilities.includes("chat")
  );

  const leaves = bound.filter((c) => c.residence === "cloud").length;
  const broken = bound.filter((c) => c.health === "fault" || !c.enabled);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <section className="px-2.5 pb-3 pt-3">
          <h3 className="t-label mb-1.5 text-ink-dim">Order of attempt</h3>
          <p className="t-body mb-2.5 text-ink-mute">
            Every LLM node starts at step 1 and walks down on refusal.
          </p>

          {bound.length === 0 && (
            <p className="t-body rounded-control border border-dashed border-line px-2.5 py-3 text-ink-faint">
              Nothing bound. This harness cannot run.
            </p>
          )}

          <ol className="flex flex-col gap-px">
            {bound.map((c, i) => {
              const spec = specOf(c);
              const dead = c.health === "fault" || !c.enabled;
              return (
                <li key={c.id}>
                  <div
                    className={`group flex items-center gap-2 rounded-control px-1.5 py-1.5 transition-colors ${
                      c.id === selectedId ? "bg-sub-300" : "hover:bg-sub-200"
                    }`}
                  >
                    <span
                      className="t-meta grid h-[16px] w-[16px] flex-none place-items-center rounded-[1px]"
                      style={{
                        background: i === 0 ? "var(--signal)" : "var(--sub-400)",
                        color: i === 0 ? "var(--signal-ink)" : "var(--ink-dim)",
                      }}
                    >
                      {i + 1}
                    </span>
                    <StateRule health={c.health} />
                    <Monogram text={spec.monogram} live={c.health === "live"} size={18} />
                    <button
                      type="button"
                      onClick={() => select(c.id)}
                      className="oh-focus-inner min-w-0 flex-1 text-left"
                    >
                      <span
                        className={`t-body block truncate ${dead ? "text-ink-faint line-through" : "text-ink-dim"}`}
                      >
                        {c.label}
                      </span>
                    </button>
                    <ResidenceMark residence={c.residence} />
                    <span className="flex flex-none gap-px opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                      <Icon label="Earlier" disabled={i === 0} onClick={() => bindMove(c.id, -1)}>
                        <ArrowUp size={11} strokeWidth={1.9} />
                      </Icon>
                      <Icon
                        label="Later"
                        disabled={i === bound.length - 1}
                        onClick={() => bindMove(c.id, 1)}
                      >
                        <ArrowDown size={11} strokeWidth={1.9} />
                      </Icon>
                      <Icon label="Unbind" onClick={() => bindToggle(c.id)}>
                        <Minus size={11} strokeWidth={1.9} />
                      </Icon>
                    </span>
                  </div>
                </li>
              );
            })}
          </ol>

          {/* Egress readout — the consequence of the chain above. */}
          {bound.length > 0 && (
            <div className="mt-2.5 border-t border-line-soft pt-2.5">
              <p className="t-body text-ink-mute">
                {leaves === 0 ? (
                  <>
                    No step in this chain leaves the machine.{" "}
                    <span className="text-ink-dim">Nothing is billed and nothing is sent.</span>
                  </>
                ) : (
                  <>
                    <span className="text-ink">
                      {leaves} of {bound.length}
                    </span>{" "}
                    steps send the prompt off this machine. A local-first graph still reaches a
                    vendor the moment step {bound.findIndex((c) => c.residence === "cloud") + 1} is
                    used.
                  </>
                )}
              </p>
            </div>
          )}

          {broken.length > 0 && (
            <p className="t-body mt-2.5 flex items-start gap-1.5 text-warn">
              <TriangleAlert size={12} strokeWidth={1.8} className="mt-[2px] flex-none" />
              {broken.length === 1
                ? `Step ${bound.indexOf(broken[0]) + 1} will be skipped — ${HEALTH_LABEL[broken[0].health]}.`
                : `${broken.length} steps will be skipped.`}
            </p>
          )}
        </section>

        {rest.length > 0 && (
          <section className="border-t border-line-soft px-2.5 pb-4 pt-3">
            <h3 className="t-label mb-1.5 text-ink-dim">Available</h3>
            <p className="t-body mb-2 text-ink-mute">
              Connections that can serve a completion but are not in the chain.
            </p>
            <div className="flex flex-col gap-px">
              {rest.map((c) => {
                const spec = specOf(c);
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => bindToggle(c.id)}
                    className="oh-focus-inner flex items-center gap-2 rounded-control px-1.5 py-1.5 text-left transition-colors hover:bg-sub-200"
                  >
                    <Plus size={11} strokeWidth={1.9} className="flex-none text-ink-faint" />
                    <Monogram text={spec.monogram} size={18} />
                    <span className="t-body min-w-0 flex-1 truncate text-ink-mute">{c.label}</span>
                    <span
                      className="t-meta flex-none"
                      style={{ color: HEALTH_INK[c.health] }}
                      title={HEALTH_LABEL[c.health]}
                    >
                      {c.health === "live" ? "" : HEALTH_LABEL[c.health]}
                    </span>
                    <ResidenceMark residence={c.residence} />
                  </button>
                );
              })}
            </div>
          </section>
        )}

        {/* Cursor cannot serve completions, so it is stated here rather than
            silently omitted from the list above. */}
        <section className="border-t border-line-soft px-2.5 pb-6 pt-3">
          <h3 className="t-label mb-1.5 text-ink-faint">Not eligible</h3>
          {connections
            .filter((c) => !specOf(c).capabilities.includes("chat"))
            .map((c) => (
              <p key={c.id} className="t-body text-ink-faint">
                <span className="text-ink-mute">{c.label}</span> answers delegation, not completion
                — bind it to a Delegate node instead.
              </p>
            ))}
        </section>
      </div>
    </div>
  );
}

function Icon({
  children,
  onClick,
  label,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      disabled={disabled}
      className="grid h-[18px] w-[18px] place-items-center rounded-[1px] text-ink-faint transition-colors hover:bg-sub-300 hover:text-ink-dim disabled:opacity-30"
    >
      {children}
    </button>
  );
}
