"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, Clock, Play, Plus, Trash2, Workflow } from "lucide-react";

import { Panel } from "@/components/shell/Panel";
import { ListGroup, ListRow, RowAction, StatusDot, type Tone } from "@/components/shell/ListRow";
import { splitHarnessName } from "@/components/harnesses/harnessLabel";
import { automationsApi, type AutomationJob } from "@/lib/automationsApi";
import { describeSchedule, formatNextRun, nextRun, parseSchedule, toCron, type ScheduleKind } from "@/lib/scheduleCron";
import { useHarnessLibraryStore } from "@/store/harnessLibraryStore";
import { useHarnessSessionStore } from "@/store/harnessSessionStore";

/* Hallmark · genre: modern-minimal editorial workspace
   macrostructure: Standing Desk · design-system: design.md · designed-as-app */
/** Saved schedules currently execute simulations. Drafts stay local until Create. */
const DRAFT_ID = "__draft__";

export function AutomationsPanel() {
  const [jobs, setJobs] = useState<AutomationJob[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [error, setError] = useState("");

  const upsert = (saved: AutomationJob) => setJobs((current) => [saved, ...(current ?? []).filter((item) => item.id !== saved.id)]);

  const activeBundleId = useHarnessSessionStore((s) => s.activeBundle?.manifest.id ?? null);

  const refresh = useCallback(async () => {
    try {
      const data = await automationsApi.list();
      setJobs(data.jobs);
      setError("");
    } catch (e) {
      setJobs([]);
      setError((e as Error).message || "Couldn't reach automations");
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const isDraft = openId === DRAFT_ID;
  const open = isDraft ? null : (openId && jobs?.find((j) => j.id === openId)) || null;
  const showingDetail = isDraft || !!open;

  return (
    <Panel
      title="Automate"
      className="h-full"
      actions={
        !showingDetail && (
          <button
            type="button"
            onClick={() => setOpenId(DRAFT_ID)}
            className="inline-flex h-6 items-center gap-1.5 rounded-[6px] px-2 text-[12px] font-[550] text-ink-mute transition-colors hover:bg-sub-200 hover:text-ink"
          >
            <Plus size={13} strokeWidth={1.8} />
            New automation
          </button>
        )
      }
    >
      <p className="border-b border-line-soft px-3 py-3 text-[12px] leading-5 text-ink-dim">Simulation mode: jobs save schedules and return mock results. Agents and providers are not executed.</p>
      {showingDetail ? (
        <Detail
          key={openId}
          job={open}
          defaultHarnessId={activeBundleId}
          onBack={() => setOpenId(null)}
          onChanged={upsert}
          onCreated={async (job) => {
            upsert(job);
            setOpenId(job.id);
          }}
          onDeleted={() => {
            setJobs((current) => (current ?? []).filter((item) => item.id !== openId));
            setOpenId(null);
          }}
        />
      ) : (
        <Listing jobs={jobs} error={error} onOpen={setOpenId} onNew={() => setOpenId(DRAFT_ID)} />
      )}
    </Panel>
  );
}

// ── List ────────────────────────────────────────────────────────────────────
function statusTone(job: AutomationJob): { text: string; tone: Tone } {
  if (job.status === "running") return { text: "Simulation running", tone: "warn" };
  if (job.status === "error" || job.result?.ok === false) return { text: "Simulation failed", tone: "fault" };
  if (job.result?.mode === "mock" && job.result.ok === true) return { text: "Simulation completed", tone: "ok" };
  if (job.lastRunAt) return { text: "Last attempt recorded", tone: "idle" };
  return { text: job.cron ? "Scheduled simulation" : "On demand", tone: "idle" };
}

function Listing({
  jobs,
  error,
  onOpen,
  onNew,
}: {
  jobs: AutomationJob[] | null;
  error: string;
  onOpen: (id: string) => void;
  onNew: () => void;
}) {
  if (jobs === null) return <p className="px-3 py-3 text-[12px] text-ink-mute">Loading…</p>;

  if (jobs.length === 0) {
    return (
      <div className="flex flex-col items-center px-3 py-8 text-center">
        {/* Working, not idle: this is where Nilo runs the job while you're elsewhere. */}
        <p className="mt-3 text-[13px] text-ink">No automations yet.</p>
        <p className="mt-1 max-w-[260px] text-[12px] text-ink-mute">
          {error || "Save a schedule and harness choice, then try a simulation."}
        </p>
        {/* One way in, not two: the panel header already has "New automation". */}
      </div>
    );
  }

  const groups = groupByDay(jobs);

  return (
    <>
      {/* Identity lives in the populated list too, not just the empty state —
          this is the surface where jobs run while you're elsewhere. */}
      <div className="flex items-center gap-2 border-b border-line-soft px-3 py-2 text-[11px] text-ink-faint">
        <Clock size={12} strokeWidth={1.8} />
        {jobs.length} automation{jobs.length === 1 ? "" : "s"} · simulation jobs
      </div>
      {groups.map(({ label, items }) => (
        <ListGroup key={label} label={label}>
          {items.map((job) => {
            const s = statusTone(job);
            return (
              <ListRow
                key={job.id}
                title={job.name}
                subtitle={s.text}
                leading={<StatusDot tone={s.tone} />}
                trailing={
                  <span className="text-[11px] text-ink-faint">
                    {job.lastRunAt ? relative(job.lastRunAt) : "never run"}
                  </span>
                }
                onSelect={() => onOpen(job.id)}
              />
            );
          })}
        </ListGroup>
      ))}
    </>
  );
}

const DAY = 86_400_000;

/** Groups by the day the job last ran; jobs that never ran land in "New". */
function groupByDay(jobs: AutomationJob[]): { label: string; items: AutomationJob[] }[] {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const bucketOf = (job: AutomationJob) => {
    if (!job.lastRunAt) return "New";
    const ts = Date.parse(job.lastRunAt);
    if (ts >= startOfToday) return "Today";
    if (ts >= startOfToday - DAY) return "Yesterday";
    return "Earlier";
  };
  const order = ["New", "Today", "Yesterday", "Earlier"];
  const buckets = new Map<string, AutomationJob[]>();
  for (const job of jobs) {
    const label = bucketOf(job);
    (buckets.get(label) ?? buckets.set(label, []).get(label)!).push(job);
  }
  return order.filter((label) => buckets.has(label)).map((label) => ({ label, items: buckets.get(label)! }));
}

// ── Detail ──────────────────────────────────────────────────────────────────
type Tab = "settings" | "history";
const KINDS: { id: ScheduleKind; label: string }[] = [
  { id: "manual", label: "On demand" },
  { id: "daily", label: "Every day" },
  { id: "weekdays", label: "Weekdays" },
  { id: "hourly", label: "Every hour" },
  { id: "custom", label: "Custom cron" },
];

/**
 * `job === null` means a draft: nothing persisted, every field lives in local
 * state, and the only backend call the whole screen makes is the single
 * `create` on "Create automation". Existing jobs save all edited fields together on Save changes.
 */
function Detail({
  job,
  defaultHarnessId,
  onBack,
  onChanged,
  onCreated,
  onDeleted,
}: {
  job: AutomationJob | null;
  defaultHarnessId: string | null;
  onBack: () => void;
  onChanged: (job: AutomationJob) => void;
  onCreated: (job: AutomationJob) => Promise<void>;
  onDeleted: () => void;
}) {
  const isDraft = job === null;
  const entries = useHarnessLibraryStore((s) => s.entries);
  const hydrateLibrary = useHarnessLibraryStore((s) => s.hydrate);
  const libraryHydrated = useHarnessLibraryStore((s) => s.hydrated);

  const [tab, setTab] = useState<Tab>("settings");
  const [name, setName] = useState(job?.name ?? "");
  const initialHarnessId = job ? (job.harnessEnabled ? job.harnessBundleId : null) : defaultHarnessId;
  const [harnessId, setHarnessId] = useState(initialHarnessId);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const sched = useMemo(() => parseSchedule(job?.cron ?? null), [job]);
  const [kind, setKind] = useState<ScheduleKind>(sched.kind);
  const [time, setTime] = useState(sched.time || "09:00");
  const [rawCron, setRawCron] = useState(sched.kind === "custom" ? (job?.cron ?? "") : "");

  useEffect(() => {
    if (!libraryHydrated) void hydrateLibrary().catch(() => undefined);
  }, [libraryHydrated, hydrateLibrary]);

  useEffect(() => {
    setName(job?.name ?? "");
    setHarnessId(initialHarnessId);
    const s = parseSchedule(job?.cron ?? null);
    setKind(s.kind);
    setTime(s.time || "09:00");
    setRawCron(s.kind === "custom" ? (job?.cron ?? "") : "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job?.id]);

  const cronNow = kind === "custom" ? rawCron.trim() || null : toCron(kind, time);
  const dirty = !job || name.trim() !== job.name || cronNow !== job.cron || harnessId !== initialHarnessId;

  // Honesty gate: never imply a next run without saying so explicitly, and
  // never show one at all for kinds that don't have one (manual) or that
  // nextRun() can't safely compute (custom — arbitrary cron isn't parsed).
  const upcoming = kind === "manual" || kind === "custom" ? null : nextRun(cronNow);
  const nextRunLine =
    kind === "manual"
      ? "No scheduled next run — this automation only runs when you start it."
      : kind === "custom"
        ? "Next run isn't previewed for custom cron — it still evaluates in UTC on the server."
        : upcoming
          ? `Next run: ${formatNextRun(upcoming)}`
          : "Next run unavailable — check the time above.";

  const onName = (value: string) => setName(value);
  const applySchedule = (nextKind: ScheduleKind, nextTime: string, raw: string) => {
    setKind(nextKind);
    setTime(nextTime);
    setRawCron(raw);
  };
  const onHarness = (id: string | null) => setHarnessId(id);

  const persist = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setBusy(true);
    setErr("");
    try {
      const payload = { name: trimmed, cron: cronNow, harnessBundleId: harnessId, harnessEnabled: Boolean(harnessId) };
      if (job) onChanged(await automationsApi.update(job.id, payload));
      else await onCreated(await automationsApi.create(payload));
    } catch (e) {
      setErr((e as Error).message || "Save failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <button
        type="button"
        onClick={onBack}
        className="flex flex-none items-center gap-1.5 px-2.5 py-2 text-[12px] font-[500] text-ink-mute transition-colors hover:text-ink"
      >
        <ArrowLeft size={13} strokeWidth={1.8} />
        All automations
      </button>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-6">
        <input
          value={name}
          disabled={busy}
          onChange={(e) => onName(e.target.value)}
          placeholder="Name this automation"
          aria-label="Automation name"
          autoFocus={isDraft}
          className="w-full rounded-[7px] bg-transparent px-1.5 py-1 text-[16px] font-[600] text-ink outline-none transition-colors placeholder:text-ink-faint hover:bg-sub-200 focus:bg-sub-200"
        />
        <div className="mt-1 flex items-center gap-2 px-1.5 text-[12px] text-ink-mute">
          {isDraft ? (
            <>
              <StatusDot tone="idle" />
              Draft — not saved until you create it
            </>
          ) : (
            <>
              <StatusDot tone={statusTone(job).tone} />
              {statusTone(job).text}
            </>
          )}
        </div>

        {!isDraft && <p role="status" className="mt-2 px-1.5 text-[12px] text-ink-dim">{dirty ? "Unsaved changes — save before running a simulation." : "Saved"}</p>}
        <div className="mt-4 flex gap-1 border-b border-line-soft">
          {(isDraft ? (["settings"] as Tab[]) : (["settings", "history"] as Tab[])).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={[
                "-mb-px border-b-2 px-2 pb-2 text-[13px] font-[550] capitalize transition-colors",
                tab === t ? "border-signal text-ink" : "border-transparent text-ink-mute hover:text-ink",
              ].join(" ")}
            >
              {t === "history" ? "Last attempt" : t}
            </button>
          ))}
        </div>

        {err && <p role="alert" className="mt-2 text-[12px] text-fault">{err}</p>}

        {tab === "settings" ? (
          <div className="mt-4 flex flex-col gap-6">
            <section>
              <h3 className="mb-2 text-[12px] font-[600] text-ink">Trigger</h3>
              <div className="flex flex-wrap gap-1.5">
                {KINDS.map((k) => (
                  <button
                    key={k.id}
                    type="button"
                    onClick={() => applySchedule(k.id, time, rawCron)}
                    className={[
                      "h-8 rounded-[7px] border px-2.5 text-[12px] font-[550] transition-colors",
                      kind === k.id
                        ? "border-signal bg-sub-200 text-ink"
                        : "border-line text-ink-mute hover:border-ink-faint hover:text-ink",
                    ].join(" ")}
                  >
                    {k.label}
                  </button>
                ))}
              </div>

              {(kind === "daily" || kind === "weekdays") && (
                <label className="mt-2.5 flex items-center gap-2 text-[12px] text-ink-mute">
                  at
                  <input
                    type="time"
                    value={time}
                    aria-label="Trigger time (UTC)"
                    onChange={(e) => applySchedule(kind, e.target.value, rawCron)}
                    className="rounded-[6px] border border-line bg-sub-200 px-2 py-1 text-[12px] text-ink outline-none"
                  />
                  <span className="text-ink-faint">UTC</span>
                </label>
              )}
              {kind === "custom" && (
                <input
                  value={rawCron}
                  onChange={(e) => setRawCron(e.target.value)}
                  onBlur={() => applySchedule("custom", time, rawCron)}
                  placeholder="minute hour day-of-month month day-of-week"
                  className="mt-2.5 w-full rounded-[6px] border border-line bg-sub-200 px-2 py-1.5 font-mono text-[12px] text-ink outline-none"
                />
              )}

              <p className="mt-2.5 flex items-center gap-1.5 text-[12px] text-ink-mute">
                <Clock size={12} strokeWidth={1.8} className="text-ink-faint" />
                {describeSchedule(cronNow)}
              </p>
              <p className="mt-1 flex items-center gap-1.5 text-[12px] text-ink-dim">{nextRunLine}</p>
            </section>

            <p className="text-[12px] leading-5 text-ink-dim">Keep OpenHarness running for scheduled simulations — the scheduler only fires while the app is open.</p>
            <section>
              <h3 className="mb-2 text-[12px] font-[600] text-ink">Harness configuration</h3>
              <div className="flex items-center gap-2.5 rounded-[8px] border border-line bg-sub-100 px-3 py-2.5">
                <span className="grid h-8 w-8 flex-none place-items-center rounded-[8px] bg-sub-200 text-ink-mute">
                  <Workflow size={15} strokeWidth={1.7} />
                </span>
                <span className="min-w-0 flex-1">
                  <select
                    aria-label="Harness"
                    disabled={busy}
                    value={harnessId ?? ""}
                    onChange={(e) => onHarness(e.target.value || null)}
                    className="w-full bg-transparent text-[13px] font-[550] text-ink outline-none"
                  >
                    <option value="">Direct — no harness</option>
                    {entries.map((e) => (
                      <option key={e.id} value={e.id}>
                        {splitHarnessName(e.name).title}
                      </option>
                    ))}
                  </select>
                  <span className="block text-[11px] text-ink-mute">Saved for this job. Simulations do not execute the harness or contact providers.</span>
                </span>
              </div>
            </section>

            <div className="flex flex-wrap items-center gap-2">
              {isDraft ? (
                <button
                  type="button"
                  disabled={busy || !name.trim()}
                  onClick={() => void persist()}
                  className="inline-flex h-8 items-center gap-1.5 rounded-[8px] bg-signal px-3 text-[12px] font-[550] text-signal-ink transition hover:brightness-110 disabled:opacity-40"
                >
                  <Plus size={12} strokeWidth={2} />
                  Create automation
                </button>
              ) : (
                <>
                  <button type="button" disabled={busy || !dirty} onClick={() => void persist()} className="h-8 rounded-control border border-line px-3 text-[12px] font-[550] text-ink hover:bg-sub-200 disabled:opacity-40">Save changes</button>
                  <button
                    type="button"
                    disabled={busy || dirty}
                    onClick={() => void automationsApi.runNow(job.id, "mock").then(onChanged)}
                    className="inline-flex h-8 items-center gap-1.5 rounded-[8px] bg-signal px-3 text-[12px] font-[550] text-signal-ink transition hover:brightness-110 disabled:opacity-40"
                  >
                    <Play size={12} strokeWidth={2} />
                    Run simulation
                  </button>
                  <span className="flex-1" />
                  <RowAction label="Delete automation" onClick={() => void automationsApi.remove(job.id).then(onDeleted)}>
                    <Trash2 size={13} strokeWidth={1.8} />
                  </RowAction>
                </>
              )}
            </div>
          </div>
        ) : (
          <div className="mt-4">
            {job?.lastRunAt ? (
              <div className="rounded-[8px] border border-line bg-sub-100 px-3 py-2.5">
                <div className="flex items-center gap-1.5 text-[13px] text-ink">
                  <StatusDot tone={statusTone(job).tone} />
                  {statusTone(job).text}
                </div>
                <p className="mt-1 text-[12px] text-ink-mute">Last run {absolute(new Date(job.lastRunAt))}</p>
              </div>
            ) : (
              <p className="text-[12px] text-ink-mute">This automation hasn’t run yet.</p>
            )}
            {job?.lastRunAt && !job.result && <p className="mt-3 text-[12px] text-ink-dim">No result details are available for this attempt.</p>}
          </div>
        )}
      </div>
    </div>
  );
}

// ── time helpers ────────────────────────────────────────────────────────────
function relative(iso: string): string {
  const diff = Date.now() - Date.parse(iso);
  if (!Number.isFinite(diff)) return "";
  if (diff < 3_600_000) return `${Math.max(1, Math.floor(diff / 60_000))}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}
function absolute(d: Date): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
    }).format(d);
  } catch {
    return d.toISOString();
  }
}
