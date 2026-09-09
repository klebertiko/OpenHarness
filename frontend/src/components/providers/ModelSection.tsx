"use client";
import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Check, Minus, Plus, Search, Terminal } from "lucide-react";
import { Chip } from "./atoms";
import { Btn } from "./CredentialSeal";
import { specOf, useProviderStore, type Connection, type ModelInfo } from "./providerStore";

/**
 * How a connection's models are chosen.
 *
 * Four providers, four genuinely different answers, so this is a switch and not
 * a shared dropdown:
 *
 *   fixed      Anthropic / OpenAI — a short published list. You allow-list.
 *   installed  Ollama local — whatever you have pulled. Sizes matter, price does not.
 *   hosted     Ollama Cloud — whatever ollama.com runs today.
 *   routed     OpenRouter — a market. You do not pick a model, you declare a
 *              preference order and a tie-break, and the first available wins.
 *   agent-only Cursor — there is nothing to pick. See the note in the dossier.
 */

const money = (n: number) => (n >= 1 ? `$${n.toFixed(2)}` : `$${n.toFixed(3)}`);
const ctx = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)}k` : String(n));

export function ModelSection({ c }: { c: Connection }) {
  const spec = specOf(c);
  switch (spec.catalogue) {
    case "routed":
      return <Routed c={c} />;
    case "agent-only":
      return null;
    default:
      return <AllowList c={c} />;
  }
}

/* ── Allow-list: fixed / installed / hosted ───────────────────────────────── */

function AllowList({ c }: { c: Connection }) {
  const spec = specOf(c);
  const toggle = useProviderStore((s) => s.toggleAllowed);
  const local = spec.catalogue === "installed";

  if (!c.models.length) {
    return (
      <Block
        title="Models"
        lede="Nothing to list until this connection answers a probe."
        chip={<Chip>0</Chip>}
      >
        <span />
      </Block>
    );
  }

  return (
    <Block
      title="Models"
      chip={
        <Chip tone={c.allowed.length ? "signal" : "dim"}>
          {c.allowed.length} of {c.models.length} allowed
        </Chip>
      }
      lede={
        local
          ? "Pulled to this machine. Untick a model to keep nodes from selecting it."
          : "Published by the vendor for this key. Untick a model to keep nodes from selecting it."
      }
    >
      <div className="rounded-control border border-line-soft">
        <Head cols={local ? ["model", "context", "on disk"] : ["model", "context", "$ / Mtok in→out"]} />
        {c.models.map((m, i) => {
          const on = c.allowed.includes(m.id);
          return (
            <button
              key={m.id}
              type="button"
              onClick={() => toggle(c.id, m.id)}
              className={[
                "oh-focus-inner grid w-full grid-cols-[18px_1fr_58px_120px] items-center gap-2 px-2 py-[5px] text-left transition-colors",
                i ? "border-t border-line-soft" : "",
                on ? "bg-sub-200" : "",
                "hover:bg-sub-300",
              ].join(" ")}
            >
              <Tick on={on} />
              <span className={`t-meta truncate ${on ? "text-ink" : "text-ink-mute"}`}>{m.id}</span>
              <span className="t-meta text-right text-ink-faint">{ctx(m.ctx)}</span>
              <span className="t-meta text-right text-ink-faint">
                {m.size ?? (m.price ? `${money(m.price[0])} → ${money(m.price[1])}` : "—")}
              </span>
            </button>
          );
        })}
      </div>
    </Block>
  );
}

/* ── Routed: OpenRouter ───────────────────────────────────────────────────────
   The whole reason this branch exists. A single-model dropdown would be a lie
   about what OpenRouter is — you are buying availability across vendors, so the
   unit of configuration is an ordered route with a tie-break, and the panel ends
   by showing the exact payload that route compiles to. */

const SORTS: { id: Connection["routeSort"]; label: string; why: string }[] = [
  { id: "price", label: "cheapest", why: "lowest $/Mtok among providers serving it" },
  { id: "throughput", label: "fastest", why: "highest measured tokens/sec" },
  { id: "latency", label: "first token", why: "lowest time to first token" },
];

function Routed({ c }: { c: Connection }) {
  const { addToRoute, removeFromRoute, moveInRoute, setRouteSort } = useProviderStore();
  const [q, setQ] = useState("");

  const byId = useMemo(() => new Map(c.models.map((m) => [m.id, m])), [c.models]);
  const catalog = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return c.models.filter(
      (m) =>
        !c.route.includes(m.id) &&
        (!needle || m.id.includes(needle) || (m.via ?? "").toLowerCase().includes(needle))
    );
  }, [c.models, c.route, q]);

  return (
    <>
      <Block
        title="Route"
        chip={<Chip tone={c.route.length ? "signal" : "warn"}>{c.route.length} deep</Chip>}
        lede="OpenRouter is a market, not a model. A node targeting this connection sends the whole
        list; the first choice that is up and in budget answers."
      >
        {c.route.length === 0 ? (
          <p className="t-body text-warn">
            An empty route falls back to OpenRouter&rsquo;s default, which can change without
            notice. Add at least one model.
          </p>
        ) : (
          <ol className="rounded-control border border-line-soft">
            {c.route.map((id, i) => {
              const m = byId.get(id);
              return (
                <li
                  key={id}
                  className={`grid grid-cols-[20px_1fr_88px_112px_auto] items-center gap-2 px-2 py-[6px] ${
                    i ? "border-t border-line-soft" : ""
                  }`}
                >
                  <span
                    className="t-meta grid h-[16px] w-[16px] place-items-center rounded-[1px] text-signal-ink"
                    style={{ background: i === 0 ? "var(--signal)" : "var(--sub-400)" }}
                  >
                    <span style={{ color: i === 0 ? "var(--signal-ink)" : "var(--ink-dim)" }}>
                      {i + 1}
                    </span>
                  </span>
                  <span className="t-meta truncate text-ink">{id}</span>
                  <span className="t-body truncate text-ink-faint">{m?.via ?? "—"}</span>
                  <span className="t-meta text-right text-ink-faint">
                    {m?.price ? `${money(m.price[0])} → ${money(m.price[1])}` : "—"}
                  </span>
                  <span className="flex gap-px">
                    <Icon
                      label="Move up"
                      disabled={i === 0}
                      onClick={() => moveInRoute(c.id, id, -1)}
                    >
                      <ArrowUp size={11} strokeWidth={1.9} />
                    </Icon>
                    <Icon
                      label="Move down"
                      disabled={i === c.route.length - 1}
                      onClick={() => moveInRoute(c.id, id, 1)}
                    >
                      <ArrowDown size={11} strokeWidth={1.9} />
                    </Icon>
                    <Icon label="Remove" onClick={() => removeFromRoute(c.id, id)}>
                      <Minus size={11} strokeWidth={1.9} />
                    </Icon>
                  </span>
                </li>
              );
            })}
          </ol>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="t-label text-ink-faint">tie-break</span>
          {SORTS.map((s) => (
            <Chip
              key={s.id}
              active={c.routeSort === s.id}
              tone={c.routeSort === s.id ? "signal" : "dim"}
              title={s.why}
              onClick={() => setRouteSort(c.id, s.id)}
            >
              {s.label}
            </Chip>
          ))}
          <span className="t-body text-ink-faint">
            {SORTS.find((s) => s.id === c.routeSort)?.why}
          </span>
        </div>

        {/* What the route actually compiles to. An instrument shows its output. */}
        <pre className="t-meta mt-3 overflow-x-auto rounded-control border border-line-soft bg-sub-000 px-2.5 py-2 text-ink-mute">
          {`POST ${c.endpoint}/chat/completions
{ "models": [${c.route.map((m) => `"${m}"`).join(", ") || ""}],
  "provider": { "sort": "${c.routeSort}", "allow_fallbacks": true } }`}
        </pre>
      </Block>

      <Block
        title="Catalog"
        chip={<Chip>{c.models.length} models</Chip>}
        lede="Prices and availability are set upstream and move without notice."
      >
        <div className="mb-2 flex h-[27px] items-center gap-2 rounded-control border border-line-soft bg-sub-200 px-2 focus-within:border-signal-deep">
          <Search size={12} strokeWidth={1.8} className="flex-none text-ink-faint" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="filter by model id or vendor"
            className="t-body min-w-0 flex-1 bg-transparent text-ink outline-none"
          />
          {q && <span className="t-meta text-ink-faint">{catalog.length}</span>}
        </div>

        <div className="max-h-[220px] overflow-y-auto rounded-control border border-line-soft">
          <Head cols={["model", "vendor", "context", "$ / Mtok in→out"]} routed />
          {catalog.length === 0 && (
            <p className="t-body px-2 py-3 text-ink-faint">Nothing matches “{q}”.</p>
          )}
          {catalog.map((m, i) => (
            <button
              key={m.id}
              type="button"
              onClick={() => addToRoute(c.id, m.id)}
              className={`oh-focus-inner grid w-full grid-cols-[1fr_88px_58px_112px_18px] items-center gap-2 px-2 py-[5px] text-left transition-colors hover:bg-sub-300 ${
                i ? "border-t border-line-soft" : ""
              }`}
            >
              <span className="t-meta truncate text-ink-dim">{m.id}</span>
              <span className="t-body truncate text-ink-faint">{m.via}</span>
              <span className="t-meta text-right text-ink-faint">{ctx(m.ctx)}</span>
              <span className="t-meta text-right text-ink-faint">
                {m.price ? `${money(m.price[0])} → ${money(m.price[1])}` : "—"}
              </span>
              <Plus size={11} strokeWidth={1.9} className="text-ink-faint" />
            </button>
          ))}
        </div>
      </Block>
    </>
  );
}

/* ── Cursor: the handoff, since there is nothing to configure ─────────────── */

export function CursorHandoff({ c }: { c: Connection }) {
  return (
    <Block
      title="Handoff"
      lede="Cursor runs the agent; OpenHarness hands it the task and reads the result back."
    >
      <div className="grid gap-2 sm:grid-cols-2">
        <Card
          k="Cloud agent"
          v="POST /v1/agents"
          body="Runs on Cursor's infrastructure against a connected repository. Returns an id you can poll or stream."
          action={<Btn>Delegate a task</Btn>}
        />
        <Card
          k="Local CLI"
          v="cursor-agent -p --output-format stream-json"
          body="Runs on this machine under your Cursor seat, with your working tree. OpenHarness pipes stdout back into the graph."
          action={
            <Btn>
              <Terminal size={12} strokeWidth={1.7} />
              Launch in terminal
            </Btn>
          }
        />
      </div>
    </Block>
  );
}

/* ── Shared chrome ────────────────────────────────────────────────────────── */

export function Block({
  title,
  chip,
  lede,
  children,
}: {
  title: string;
  chip?: React.ReactNode;
  lede?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="border-t border-line-soft py-4">
      <header className="mb-2.5 flex items-center gap-2">
        <h3 className="t-label text-ink-dim">{title}</h3>
        {chip}
      </header>
      {lede && <p className="t-body mb-2.5 max-w-[70ch] text-ink-mute">{lede}</p>}
      {children}
    </section>
  );
}

function Head({ cols, routed }: { cols: string[]; routed?: boolean }) {
  return (
    <div
      className={`grid items-center gap-2 border-b border-line bg-sub-200 px-2 py-1 ${
        routed ? "grid-cols-[1fr_88px_58px_112px_18px]" : "grid-cols-[18px_1fr_58px_120px]"
      }`}
    >
      {!routed && <span />}
      {cols.map((c, i) => (
        <span
          key={c}
          className={`t-label truncate text-ink-faint ${i === 0 ? "" : "text-right"}`}
        >
          {c}
        </span>
      ))}
      {routed && <span />}
    </div>
  );
}

function Tick({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden
      className="grid h-[13px] w-[13px] place-items-center rounded-[1px] border"
      style={{
        borderColor: on ? "var(--signal)" : "var(--line)",
        background: on ? "var(--signal)" : "transparent",
      }}
    >
      {on && <Check size={9} strokeWidth={3} style={{ color: "var(--signal-ink)" }} />}
    </span>
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
      className="grid h-[18px] w-[18px] place-items-center rounded-[1px] text-ink-faint transition-colors hover:bg-sub-300 hover:text-ink-dim disabled:opacity-30 disabled:hover:bg-transparent"
    >
      {children}
    </button>
  );
}

function Card({
  k,
  v,
  body,
  action,
}: {
  k: string;
  v: string;
  body: string;
  action: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-control border border-line-soft bg-sub-200 p-2.5">
      <div className="t-title text-ink">{k}</div>
      <div className="t-meta break-all text-ink-faint">{v}</div>
      <p className="t-body flex-1 text-ink-mute">{body}</p>
      <div>{action}</div>
    </div>
  );
}
