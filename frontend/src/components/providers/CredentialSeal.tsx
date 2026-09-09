"use client";
import { useRef, useState } from "react";
import { KeyRound, ShieldCheck, Trash2, TriangleAlert } from "lucide-react";
import { VAULT_LABEL, activeVault } from "./secrets";
import type { Connection } from "./providerStore";
import type { ProviderSpec } from "./catalog";
import { Chip } from "./atoms";

/**
 * Credential block.
 *
 * The POC had a plain `<input type="text">` bound to the key. This replaces it
 * outright, and the replacement is built around one idea: a stored credential
 * is not a *field*, it is a *seal*. A field implies a value you can read, edit
 * and copy. A seal shows you which key is in there and offers exactly two
 * verbs — replace it, or destroy it.
 *
 * The redaction is drawn, not typed. It is a striped bar with `user-select:
 * none`, not a run of bullet characters, because a run of bullets still looks
 * like text that is merely hidden and invites people to try selecting it. A bar
 * that is visibly not text tells the truth: there is nothing here to reveal.
 */

function fmtDate(iso: string) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

/** The drawn redaction. Width tracks the real key length, capped so a 164-char
 *  OpenAI project key does not blow the layout out. */
function Redaction({ length }: { length: number }) {
  const width = Math.min(260, Math.max(48, length * 1.9));
  return (
    <span
      aria-label={`${length} characters withheld`}
      className="inline-block flex-none select-none rounded-[1px]"
      style={{
        width,
        height: 9,
        background:
          "repeating-linear-gradient(90deg, var(--sub-400) 0 2px, transparent 2px 4px)",
      }}
    />
  );
}

export function CredentialSeal({
  connection,
  spec,
  onAttach,
  onRevoke,
}: {
  connection: Connection;
  spec: ProviderSpec;
  onAttach: (plaintext: string) => Promise<void>;
  onRevoke: () => Promise<void>;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [entering, setEntering] = useState(false);
  const [busy, setBusy] = useState(false);
  /* Two booleans derived from the pasted value. The value itself is never
     lifted out of the DOM node — this is the whole point of the component. */
  const [len, setLen] = useState(0);
  const [prefixOk, setPrefixOk] = useState(true);

  const vault = activeVault();

  /* ── No credential exists for this connection by design ─────────────────── */
  if (spec.credential.kind === "none" && !entering) {
    return (
      <Section title="Credential" chip={<Chip>none required</Chip>}>
        <p className="t-body max-w-[62ch] text-ink-dim">
          The local daemon is unauthenticated. Anything on this machine that can reach{" "}
          <span className="t-meta text-ink">{connection.endpoint}</span> can use it, including other
          applications — that is Ollama&rsquo;s design, not a gap in this one.
        </p>
      </Section>
    );
  }

  /* ── Sealed ─────────────────────────────────────────────────────────────── */
  if (connection.secret && !entering) {
    const s = connection.secret;
    return (
      <Section
        title="Credential"
        chip={
          <Chip tone="signal">
            <ShieldCheck size={11} strokeWidth={1.8} />
            sealed
          </Chip>
        }
      >
        <div className="flex items-center gap-2.5 rounded-control border border-line-soft bg-sub-200 px-2.5 py-2">
          <span className="h-[15px] w-[2px] flex-none rounded-[1px] bg-signal-deep" aria-hidden />
          <span className="t-meta flex min-w-0 items-center gap-1.5">
            <span className="text-ink-dim">{s.prefix}</span>
            <Redaction length={s.length - s.prefix.length - 4} />
            <span className="text-ink">{s.tail}</span>
          </span>
        </div>

        <dl className="mt-2.5 grid grid-cols-[86px_1fr] gap-x-3 gap-y-1">
          <Row k="stored in" v={`${VAULT_LABEL[s.vault]} · ${s.service}`} />
          <Row k="length" v={`${s.length} characters`} />
          <Row k="added" v={fmtDate(s.savedAt)} />
        </dl>

        <p className="t-body mt-3 max-w-[62ch] text-ink-mute">
          OpenHarness cannot read this value back — not into this window, not into a node, not into
          a run log. The runtime asks the vault for it at request time and never hands it across.
        </p>

        <div className="mt-3 flex gap-2">
          <Btn onClick={() => setEntering(true)}>
            <KeyRound size={12} strokeWidth={1.7} />
            Replace key
          </Btn>
          <Btn tone="fault" onClick={() => void onRevoke()}>
            <Trash2 size={12} strokeWidth={1.7} />
            Remove
          </Btn>
        </div>
      </Section>
    );
  }

  /* ── Entry ──────────────────────────────────────────────────────────────── */
  const expected = spec.credential.prefix;
  const submit = async () => {
    const el = input.current;
    if (!el || !el.value.trim() || busy) return;
    setBusy(true);
    try {
      await onAttach(el.value); // value goes straight through; never stored here
    } finally {
      el.value = ""; // and is gone from the DOM before the next paint
      setLen(0);
      setPrefixOk(true);
      setBusy(false);
      setEntering(false);
    }
  };

  return (
    <Section
      title="Credential"
      chip={connection.secret ? <Chip tone="warn">replacing</Chip> : <Chip>not set</Chip>}
    >
      <label className="t-label mb-1.5 block text-ink-faint" htmlFor="oh-cred">
        paste {spec.vendor} key
      </label>
      <div className="flex gap-2">
        <input
          id="oh-cred"
          ref={input}
          type="password"
          autoComplete="off"
          spellCheck={false}
          data-1p-ignore
          placeholder={expected ? `${expected}…` : "key"}
          onChange={(e) => {
            const v = e.currentTarget.value;
            setLen(v.length);
            setPrefixOk(!expected || v.length < expected.length || v.startsWith(expected));
          }}
          onKeyDown={(e) => e.key === "Enter" && void submit()}
          className="oh-focus-inner t-meta h-[27px] min-w-0 flex-1 rounded-control border border-line-soft bg-sub-200 px-2 tracking-[0.16em] text-ink outline-none focus:border-signal-deep"
        />
        <Btn onClick={() => void submit()} primary disabled={!len || !prefixOk || busy}>
          {busy ? "Storing…" : "Store"}
        </Btn>
        {connection.secret && <Btn onClick={() => setEntering(false)}>Cancel</Btn>}
      </div>

      {!prefixOk && (
        <p className="t-body mt-1.5 flex items-start gap-1.5 text-warn">
          <TriangleAlert size={12} strokeWidth={1.8} className="mt-[2px] flex-none" />
          {spec.vendor} keys begin <span className="t-meta">{expected}</span>. This one does not —
          check you have not pasted a key from another vendor.
        </p>
      )}

      <p className="t-body mt-2.5 max-w-[62ch] text-ink-mute">
        Stored in the {VAULT_LABEL[vault]} under{" "}
        <span className="t-meta text-ink-dim">openharness/{connection.id}</span>, then{" "}
        <span className="text-ink-dim">never shown again</span> — including to you. Keep the vendor
        copy if you need it elsewhere.
      </p>
      {vault === "memory" && (
        <p className="t-body mt-1 max-w-[62ch] text-warn">
          This build is running in a browser, so there is no OS keychain to write to. The key is
          held in memory for this session only and is lost on reload.
        </p>
      )}
      <p className="t-body mt-2 text-ink-faint">
        Get one at <span className="text-ink-mute">{spec.credential.where}</span>
      </p>
    </Section>
  );
}

/* ── Local chrome ─────────────────────────────────────────────────────────── */

function Section({
  title,
  chip,
  children,
}: {
  title: string;
  chip?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="border-t border-line-soft py-4">
      <header className="mb-2.5 flex items-center gap-2">
        <h3 className="t-label text-ink-dim">{title}</h3>
        {chip}
      </header>
      {children}
    </section>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <>
      <dt className="t-body text-ink-faint">{k}</dt>
      <dd className="t-meta truncate text-ink-dim">{v}</dd>
    </>
  );
}

export function Btn({
  children,
  onClick,
  primary,
  tone,
  disabled,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  primary?: boolean;
  tone?: "fault";
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={[
        "t-body inline-flex h-[27px] flex-none items-center gap-1.5 rounded-control border px-2.5 transition-colors disabled:opacity-40",
        primary
          ? "border-signal bg-signal text-signal-ink hover:bg-signal-deep disabled:hover:bg-signal"
          : tone === "fault"
            ? "border-line bg-sub-200 text-ink-mute hover:border-fault hover:text-fault"
            : "border-line bg-sub-200 text-ink-dim hover:bg-sub-300 hover:text-ink",
      ].join(" ")}
    >
      {children}
    </button>
  );
}
