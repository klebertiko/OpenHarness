/**
 * Human ↔ cron for the Automations trigger picker. Covers the four shapes a
 * person actually asks for; anything else is "Custom" and shown verbatim.
 * Cron is 5-field: minute hour day-of-month month day-of-week.
 */
export type ScheduleKind = "daily" | "weekdays" | "hourly" | "custom" | "manual";

export type Schedule = { kind: ScheduleKind; time: string; cron: string | null };

const HHMM = /^(\d{2}):(\d{2})$/;

/** Parse a cron string into a friendly schedule. Unknown shape → "custom". */
export function parseSchedule(cron: string | null): Schedule {
  if (!cron || !cron.trim()) return { kind: "manual", time: "09:00", cron: null };
  const parts = cron.trim().split(/\s+/);
  if (parts.length === 5) {
    const [min, hr, dom, mon, dow] = parts;
    const time = /^\d+$/.test(min) && /^\d+$/.test(hr)
      ? `${hr.padStart(2, "0")}:${min.padStart(2, "0")}`
      : "";
    if (time && dom === "*" && mon === "*") {
      if (dow === "*") return { kind: "daily", time, cron };
      if (dow === "1-5") return { kind: "weekdays", time, cron };
    }
    if (min === "0" && hr === "*" && dom === "*" && mon === "*" && dow === "*") {
      return { kind: "hourly", time: "", cron };
    }
  }
  return { kind: "custom", time: "", cron };
}

/** Build a cron string from a kind + a HH:MM time. `manual` → null (on-demand). */
export function toCron(kind: ScheduleKind, time: string): string | null {
  const m = HHMM.exec(time);
  const [h, min] = m ? [String(Number(m[1])), String(Number(m[2]))] : ["9", "0"];
  switch (kind) {
    case "daily":
      return `${min} ${h} * * *`;
    case "weekdays":
      return `${min} ${h} * * 1-5`;
    case "hourly":
      return "0 * * * *";
    case "manual":
      return null;
    case "custom":
      return null; // caller supplies the raw string
  }
}

/** One-line English for a schedule. */
export function describeSchedule(cron: string | null): string {
  const s = parseSchedule(cron);
  switch (s.kind) {
    case "manual":
      return "On demand — runs only when you start it";
    case "daily":
      return `Every day at ${s.time}`;
    case "weekdays":
      return `Weekdays at ${s.time}`;
    case "hourly":
      return "Every hour, on the hour";
    case "custom":
      return `Custom · ${cron}`;
  }
}

/**
 * The next run instant for daily / weekdays / hourly — `null` for manual
 * (nothing scheduled) and custom (no safe general parse of an arbitrary cron
 * expression). Computed in UTC because that is what the backend actually
 * matches: `backend/automations/scheduler.py`'s `cron_matches` compares the
 * cron's hour/minute fields against `datetime.now(timezone.utc)`, so the
 * HH:MM a person picks in the Trigger UI is a UTC time, not their local
 * time. Use `formatNextRun` to render the result — it shows both the UTC
 * clock time and the viewer's own local time so neither is left ambiguous.
 */
export function nextRun(cron: string | null, from = new Date()): Date | null {
  const s = parseSchedule(cron);
  if (s.kind === "hourly") {
    const d = new Date(from);
    d.setUTCMinutes(0, 0, 0);
    d.setUTCHours(d.getUTCHours() + 1);
    return d;
  }
  const m = HHMM.exec(s.time);
  if (!m || (s.kind !== "daily" && s.kind !== "weekdays")) return null;
  const d = new Date(from);
  d.setUTCHours(Number(m[1]), Number(m[2]), 0, 0);
  if (d <= from) d.setUTCDate(d.getUTCDate() + 1);
  if (s.kind === "weekdays") {
    while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() + 1);
  }
  return d;
}

/** Best-effort IANA name for the viewer's own timezone, e.g. "America/Sao_Paulo". */
export function localTimeZoneLabel(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "your local time";
  } catch {
    return "your local time";
  }
}

/**
 * Renders a `nextRun` instant as both the UTC clock time the server matches
 * against and the viewer's own local time — schedules are stored and
 * evaluated in UTC, so showing only one of the two would be misleading.
 */
export function formatNextRun(d: Date): string {
  const zone = localTimeZoneLabel();
  const local = new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
  const utc = new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "UTC",
  }).format(d);
  return `${local} (${zone}) · ${utc} UTC`;
}
