import { describe, expect, it } from "vitest";
import { describeSchedule, formatNextRun, localTimeZoneLabel, nextRun, parseSchedule, toCron } from "./scheduleCron";

describe("scheduleCron", () => {
  it("round-trips the everyday shapes", () => {
    expect(toCron("daily", "08:00")).toBe("0 8 * * *");
    expect(toCron("weekdays", "09:30")).toBe("30 9 * * 1-5");
    expect(toCron("hourly", "")).toBe("0 * * * *");
    expect(toCron("manual", "08:00")).toBeNull();

    expect(parseSchedule("0 8 * * *")).toMatchObject({ kind: "daily", time: "08:00" });
    expect(parseSchedule("30 9 * * 1-5")).toMatchObject({ kind: "weekdays", time: "09:30" });
    expect(parseSchedule("0 * * * *")).toMatchObject({ kind: "hourly" });
    expect(parseSchedule(null)).toMatchObject({ kind: "manual" });
    expect(parseSchedule("*/5 1 2 3 4")).toMatchObject({ kind: "custom" });
  });

  it("describes a schedule in one plain line", () => {
    expect(describeSchedule("0 8 * * *")).toBe("Every day at 08:00");
    expect(describeSchedule("30 9 * * 1-5")).toBe("Weekdays at 09:30");
    expect(describeSchedule("0 * * * *")).toBe("Every hour, on the hour");
    expect(describeSchedule(null)).toMatch(/^On demand/);
    expect(describeSchedule("15 3 * * 2")).toBe("Custom · 15 3 * * 2");
  });

  it("computes a plausible next run for daily and weekdays, in UTC (the server matches cron fields against UTC — see backend/automations/scheduler.py's cron_matches)", () => {
    const mondayNoonUtc = new Date(Date.UTC(2026, 8, 14, 12, 0, 0)); // Mon 2026-09-14 12:00 UTC
    const daily = nextRun("0 8 * * *", mondayNoonUtc)!;
    expect(daily.getUTCDate()).toBe(15); // 08:00 UTC already passed today
    expect(daily.getUTCHours()).toBe(8);

    const fridayEveningUtc = new Date(Date.UTC(2026, 8, 18, 20, 0, 0)); // Fri 2026-09-18 20:00 UTC
    const wd = nextRun("0 8 * * 1-5", fridayEveningUtc)!;
    expect([1, 6, 0].includes(wd.getUTCDay())).toBe(true); // Monday, never the weekend
    expect(wd.getUTCDay()).toBe(1);
  });

  it("computes the next full hour in UTC for hourly", () => {
    const midHourUtc = new Date(Date.UTC(2026, 8, 14, 5, 30, 0));
    const next = nextRun("0 * * * *", midHourUtc)!;
    expect(next.getUTCHours()).toBe(6);
    expect(next.getUTCMinutes()).toBe(0);
  });

  it("has no next-run preview for manual or custom schedules — never fabricate one", () => {
    expect(nextRun(null)).toBeNull();
    expect(nextRun("*/5 1 2 3 4")).toBeNull();
  });

  it("formats a next-run instant with an explicit, unambiguous UTC time", () => {
    const instant = new Date(Date.UTC(2026, 8, 15, 9, 0, 0));
    expect(formatNextRun(instant)).toMatch(/09:00 UTC/);
  });

  it("resolves a local timezone label without throwing", () => {
    expect(typeof localTimeZoneLabel()).toBe("string");
    expect(localTimeZoneLabel().length).toBeGreaterThan(0);
  });
});
