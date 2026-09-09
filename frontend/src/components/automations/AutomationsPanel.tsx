"use client";

import { useCallback, useEffect, useState } from "react";
import { Play, Plus, Trash2 } from "lucide-react";

import { Panel } from "@/components/shell/Panel";
import {
  automationsApi,
  effectiveHarnessEnabled,
  type AutomationJob,
} from "@/lib/automationsApi";
import { useHarnessSessionStore } from "@/store/harnessSessionStore";

/**
 * Automations / Schedules — create cron or on-demand jobs, Run now, last status.
 * Per-job harnessEnabled overrides the session harness switch.
 */
export function AutomationsPanel() {
  const sessionEnabled = useHarnessSessionStore((s) => s.enabled);
  const activeBundleId = useHarnessSessionStore((s) => s.activeBundle?.manifest.id ?? null);

  const [jobs, setJobs] = useState<AutomationJob[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [cron, setCron] = useState("");
  const [harnessOverride, setHarnessOverride] = useState(sessionEnabled);
  const [lastRun, setLastRun] = useState<AutomationJob | null>(null);

  const refresh = useCallback(async () => {
    const data = await automationsApi.list();
    setJobs(data.jobs);
  }, []);

  useEffect(() => {
    void refresh().catch((err: Error) => setError(err.message));
  }, [refresh]);

  useEffect(() => {
    setHarnessOverride(sessionEnabled);
  }, [sessionEnabled]);

  const onCreate = async () => {
    if (!name.trim()) return;
    setBusy(true);
    setError("");
    try {
      await automationsApi.create({
        name: name.trim(),
        cron: cron.trim() || null,
        harnessBundleId: activeBundleId,
        harnessEnabled: harnessOverride,
      });
      setName("");
      setCron("");
      await refresh();
    } catch (err) {
      setError((err as Error).message || "Create failed");
    } finally {
      setBusy(false);
    }
  };

  const onRun = async (id: string) => {
    setBusy(true);
    setError("");
    try {
      const result = await automationsApi.runNow(id);
      setLastRun(result);
      await refresh();
    } catch (err) {
      setError((err as Error).message || "Run failed");
    } finally {
      setBusy(false);
    }
  };

  const onToggleHarness = async (job: AutomationJob) => {
    setBusy(true);
    setError("");
    try {
      await automationsApi.update(job.id, { harnessEnabled: !job.harnessEnabled });
      await refresh();
    } catch (err) {
      setError((err as Error).message || "Update failed");
    } finally {
      setBusy(false);
    }
  };

  const onDelete = async (id: string) => {
    setBusy(true);
    setError("");
    try {
      await automationsApi.remove(id);
      await refresh();
    } catch (err) {
      setError((err as Error).message || "Delete failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel title="Automations" meta={`${jobs.length}`} className="h-full">
      <div className="border-b border-line-soft p-2.5">
        <p className="t-meta mb-2 text-ink-faint">
          Session harness: {sessionEnabled ? "on" : "off"} · job override wins on Run
        </p>
        <div className="flex flex-col gap-1.5">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Job name"
            className="h-[28px] rounded-control border border-line bg-sub-200 px-2 text-[12px] text-ink outline-none placeholder:text-ink-faint focus:border-ink-mute"
          />
          <input
            value={cron}
            onChange={(e) => setCron(e.target.value)}
            placeholder="Cron (optional) e.g. 0 9 * * *"
            className="h-[28px] rounded-control border border-line bg-sub-200 px-2 text-[12px] text-ink outline-none placeholder:text-ink-faint focus:border-ink-mute"
          />
          <label className="flex items-center gap-1.5 text-[11px] text-ink-mute">
            <input
              type="checkbox"
              checked={harnessOverride}
              onChange={(e) => setHarnessOverride(e.target.checked)}
              className="accent-[var(--signal)]"
            />
            Harness enabled for this job (override)
          </label>
          <button
            type="button"
            disabled={busy || !name.trim()}
            onClick={() => void onCreate()}
            className="inline-flex h-[28px] items-center justify-center gap-1.5 rounded-control bg-signal px-2 text-[12px] font-[550] text-signal-ink transition hover:bg-signal-deep disabled:opacity-40"
          >
            <Plus size={12} strokeWidth={1.8} />
            Create schedule
          </button>
        </div>
      </div>

      {error && (
        <p className="t-body border-b border-line-soft px-3 py-2 text-fault" role="alert">
          {error}
        </p>
      )}

      {lastRun && (
        <div className="border-b border-line-soft px-3 py-2">
          <div className="t-label text-ink-faint">LAST RUN</div>
          <div className="text-[12px] text-ink">
            {lastRun.name} · {lastRun.status}
            {lastRun.lastRunAt ? ` · ${lastRun.lastRunAt}` : ""}
          </div>
          <div className="t-meta text-ink-mute">
            harness{" "}
            {effectiveHarnessEnabled(sessionEnabled, lastRun.harnessEnabled) ? "on" : "off"}
            {lastRun.result?.ok === false ? " · failed" : " · ok"}
          </div>
        </div>
      )}

      <ul className="divide-y divide-line-soft">
        {jobs.length === 0 && (
          <li className="t-body px-3 py-3 text-ink-mute">No automations yet.</li>
        )}
        {jobs.map((job) => (
          <li key={job.id} className="flex items-start gap-2 px-3 py-2.5">
            <div className="min-w-0 flex-1">
              <div className="text-[12px] font-[550] text-ink">{job.name}</div>
              <div className="t-meta text-ink-faint">
                {job.cron ?? "on-demand"} · {job.status}
                {job.lastRunAt ? ` · last ${job.lastRunAt}` : ""}
              </div>
              <button
                type="button"
                disabled={busy}
                onClick={() => void onToggleHarness(job)}
                className="mt-1 text-[11px] text-ink-mute underline-offset-2 hover:text-ink hover:underline"
              >
                Harness {job.harnessEnabled ? "on" : "off"} (override)
              </button>
            </div>
            <button
              type="button"
              disabled={busy}
              title="Run now"
              onClick={() => void onRun(job.id)}
              className="grid h-[22px] w-[22px] flex-none place-items-center rounded-control text-signal hover:bg-sub-200"
            >
              <Play size={12} strokeWidth={1.8} />
            </button>
            <button
              type="button"
              disabled={busy}
              title="Delete job"
              onClick={() => void onDelete(job.id)}
              className="grid h-[22px] w-[22px] flex-none place-items-center rounded-control text-ink-faint hover:bg-sub-200 hover:text-ink"
            >
              <Trash2 size={12} strokeWidth={1.8} />
            </button>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
