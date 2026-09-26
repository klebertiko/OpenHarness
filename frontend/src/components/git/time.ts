/** Compact relative-time labels ("2mo", "3d", "just now") for real ISO timestamps. */
export function formatRelativeTime(iso: string | undefined | null): string {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "—";

  const diffSec = Math.round((Date.now() - t) / 1000);
  const abs = Math.abs(diffSec);
  const future = diffSec < 0;

  const label = (n: number, unit: string) => `${future ? "in " : ""}${n}${unit}${future ? "" : ""}`;

  if (abs < 60) return "just now";
  const min = Math.round(abs / 60);
  if (min < 60) return label(min, "m");
  const hr = Math.round(min / 60);
  if (hr < 24) return label(hr, "h");
  const day = Math.round(hr / 24);
  if (day < 30) return label(day, "d");
  const month = Math.round(day / 30);
  if (month < 12) return label(month, "mo");
  const year = Math.round(month / 12);
  return label(year, "y");
}
