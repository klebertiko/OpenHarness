"use client";

/**
 * Author/reviewer avatar. Falls back to an initial-letter monogram when the
 * provider gave no `authorAvatarUrl` (the fake provider always does — real
 * providers usually don't) rather than rendering a broken `<img>`.
 */
export function Avatar({
  name,
  src,
  size = 16,
}: {
  name: string;
  src?: string;
  size?: number;
}) {
  const label = name || "unknown";
  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt=""
        width={size}
        height={size}
        className="flex-none rounded-[3px] object-cover"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <span
      aria-hidden
      className="grid flex-none place-items-center rounded-[3px] bg-sub-300 text-ink-mute"
      style={{ width: size, height: size, fontSize: Math.max(8, size * 0.55) }}
    >
      {label.slice(0, 1).toUpperCase()}
    </span>
  );
}
