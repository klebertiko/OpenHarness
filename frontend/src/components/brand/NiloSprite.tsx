"use client";
import { useEffect, useRef, useState } from "react";
import { cellPaths } from "./niloGrid";
import { NILO_CANVAS, niloFrame, type Look, type Pose } from "./niloFrames";

export type NiloState = "idle" | "thinking" | "working" | "waiting" | "success" | "error" | "sleeping";

const FRAME_MS = 110;
const SLEEP_AFTER_MS = 90_000;
const GLANCES: readonly Look[] = [[-1, 0], [1, 0], [0, -1], [0, 0], [0, 0]];

/* Click reactions — a scripted pose per frame, with anticipation and a settle.
   Five quick clicks make Nilo dizzy. */
const REACTIONS: Record<string, Pose[]> = {
  hop: [
    { dy: 1, squash: -1, eyes: "happy", brow: "up" }, // crouch
    { dy: -3, squash: 1, eyes: "happy", wingL: "up", wingR: "up" }, // launch
    { dy: -5, squash: 1, eyes: "happy", wingL: "up", wingR: "up" },
    { dy: -5, eyes: "happy", wingL: "mid", wingR: "mid" }, // apex
    { dy: -2, eyes: "happy", wingL: "mid", wingR: "mid" },
    { dy: 1, squash: -1, eyes: "happy", wingL: "down", wingR: "down" }, // land
    { eyes: "happy", brow: "up" },
    { eyes: "happy" },
  ],
  wink: [
    { eyes: "wink", wingR: "mid", brow: "up" },
    { eyes: "wink", wingR: "up", brow: "up" },
    { eyes: "wink", wingR: "up" },
    { eyes: "wink", wingR: "mid" },
    { eyes: "wink" },
  ],
  headturn: [
    { look: [1, 0], tilt: 1 },
    { look: [1, 0], tilt: 1 },
    { eyes: "none", tilt: 1 },
    { eyes: "none" },
    { eyes: "none", tilt: -1 },
    { look: [-1, 0], tilt: -1 },
    { look: [-1, 0], tilt: -1 },
    { look: [0, 0] },
  ],
  ruffle: [
    { tufts: "perk", wingL: "mid", wingR: "mid", brow: "up" },
    { tufts: "perk", wingL: "up", wingR: "up" },
    { wingL: "mid", wingR: "mid" },
    { tufts: "perk", wingL: "up", wingR: "up" },
    { brow: "up" },
    {},
  ],
  hoot: [
    { beakOpen: true, tufts: "perk", brow: "up", dy: -1 },
    { beakOpen: true, tufts: "perk", brow: "up", dy: -1 },
    { beakOpen: true, tufts: "perk" },
    {},
  ],
  dizzy: [
    { eyes: "squint", tilt: 1, brow: "worry" },
    { eyes: "squint", tilt: -1, flip: true },
    { eyes: "squint", tilt: 1 },
    { eyes: "squint", tilt: -1, flip: true },
    { eyes: "squint", dy: 1, brow: "worry" },
    { eyes: "closed", brow: "worry" },
    { eyes: "closed" },
  ],
};
const PICKS = ["hop", "wink", "headturn", "ruffle", "hoot"] as const;

/** One still pose per state, used when the system asks for reduced motion. */
const STILL: Record<NiloState, Pose> = {
  idle: {},
  thinking: { look: [1, -1], brow: "down", dots: 3 },
  working: { laptop: 0, brow: "down", look: [0, 1] },
  waiting: { wingR: "up", tufts: "perk", brow: "up", tilt: 1 },
  success: { eyes: "happy", brow: "up" },
  error: { eyes: "squint", brow: "worry", tufts: "droop" },
  sleeping: { eyes: "closed", brow: "rest", z: 1, dy: 1 },
};

/** Ease a looping value through a keyframe list at ~1 frame per entry. */
const step = <T,>(seq: readonly T[], t: number) => seq[Math.max(0, Math.floor(t / FRAME_MS)) % seq.length];

function statePose(state: NiloState, tRaw: number): Pose {
  const t = Math.max(0, tRaw); // a state change can make elapsed briefly negative
  const f = Math.floor(t / FRAME_MS);
  switch (state) {
    case "idle": {
      // Breathing: a slow 1px rise and fall; the odd tuft twitch.
      const breath = Math.sin(t / 900) > 0.6 ? -1 : 0;
      const twitch = f % 47 === 0 ? ("perk" as const) : undefined;
      return { dy: breath, tufts: twitch };
    }
    case "thinking": {
      // Pupils sweep behind the glasses; brow furrows; a tuft flicks; dots pulse.
      const sweep = step([-1, -1, 0, 1, 1, 0], t) as -1 | 0 | 1;
      return {
        look: [sweep, -1],
        brow: "down",
        tilt: f % 18 < 2 ? 1 : 0,
        dots: 1 + (Math.floor(t / 300) % 3),
      };
    }
    case "working": {
      const phase = (Math.floor(t / 150) % 2) as 0 | 1;
      const glanceUp = f % 26 < 3; // checks in with you now and then
      return {
        laptop: phase,
        tick: Math.floor(t / 420),
        brow: "down",
        look: glanceUp ? [0, 0] : [0, 1],
        wingL: phase ? "mid" : "down",
        wingR: phase ? "down" : "mid",
      };
    }
    case "waiting": {
      const wave = step<Pose["wingR"]>(["mid", "up", "up", "mid"], t);
      return { wingR: wave, tufts: "perk", brow: "up", tilt: 1, look: [1, 1] };
    }
    case "success": {
      const p = step<Pose>(
        [
          { dy: 1, squash: -1 },
          { dy: -3, squash: 1, wingL: "up", wingR: "up" },
          { dy: -5, squash: 1, wingL: "up", wingR: "up" },
          { dy: -5, wingL: "mid", wingR: "mid" },
          { dy: -2, wingL: "mid", wingR: "mid" },
          { dy: 1, squash: -1, wingL: "down", wingR: "down" },
          {},
          {},
        ],
        t,
      );
      return { eyes: "happy", brow: "up", ...p };
    }
    case "error":
      return { eyes: "squint", brow: "worry", tufts: "droop", tilt: f % 6 < 3 ? -1 : 1, dy: 1 };
    case "sleeping":
      return {
        eyes: "closed",
        tufts: "droop",
        dy: 1 + (Math.sin(t / 1600) > 0 ? 1 : 0),
        z: Math.floor(t / 650) % 3,
      };
    default:
      return {};
  }
}

type Props = {
  state?: NiloState;
  /** CSS px per pixel cell; keep it an integer so edges stay crisp. */
  cell?: number;
  /** "face" crops to the head, for inline status lines. */
  crop?: "full" | "face";
  /** Follows the pointer, reacts to clicks and dozes off when left alone. */
  interactive?: boolean;
  className?: string;
  label?: string;
};

/** Nilo, animated: blinks, glances, and acts out the agent's state. */
export function NiloSprite({ state = "idle", cell = 6, crop = "full", interactive = false, className = "", label }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [now, setNow] = useState(0);
  const [bubble, setBubble] = useState<string | null>(null);
  const life = useRef({
    since: 0,
    lastActive: 0,
    blinkAt: 0,
    blinkUntil: 0,
    glance: [0, 0] as Look,
    glanceAt: 0,
    pointer: null as Look | null,
    reaction: null as { frames: Pose[]; start: number } | null,
    clicks: [] as number[],
    still: false,
  });

  useEffect(() => {
    const l = life.current;
    l.since = l.lastActive = performance.now();
    l.still = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    setNow(l.since);
    if (l.still) return;
    const id = window.setInterval(() => setNow(performance.now()), FRAME_MS);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    life.current.since = performance.now();
  }, [state]);

  useEffect(() => {
    if (!interactive) return;
    const onMove = (e: PointerEvent) => {
      const l = life.current;
      l.lastActive = performance.now();
      const r = svgRef.current?.getBoundingClientRect();
      if (!r) return;
      const vx = e.clientX - (r.left + r.width / 2);
      const vy = e.clientY - (r.top + r.height * 0.4);
      const dead = r.width / 3;
      l.pointer =
        Math.hypot(vx, vy) > 480
          ? null
          : [Math.abs(vx) > dead ? (Math.sign(vx) as -1 | 1) : 0, vy < -dead ? -1 : vy > dead * 1.6 ? 1 : 0];
    };
    window.addEventListener("pointermove", onMove);
    return () => window.removeEventListener("pointermove", onMove);
  }, [interactive]);

  const l = life.current;
  const asleep = interactive && state === "idle" && now - l.lastActive > SLEEP_AFTER_MS;
  const shown: NiloState = asleep ? "sleeping" : state;
  let pose: Pose;
  if (l.still) {
    pose = STILL[shown];
  } else {
    if (now > l.blinkAt) {
      l.blinkUntil = now + 140;
      l.blinkAt = now + 2400 + Math.random() * 3600;
    }
    if (now > l.glanceAt) {
      l.glance = GLANCES[Math.floor(Math.random() * GLANCES.length)];
      l.glanceAt = now + 1400 + Math.random() * 2600;
    }
    pose = {
      look: l.pointer ?? l.glance,
      tufts: l.pointer && shown === "idle" ? "perk" : undefined,
      ...statePose(shown, now - l.since),
    };
    if (!pose.eyes && now < l.blinkUntil) pose.eyes = "closed";
    const r = l.reaction;
    if (r) {
      const i = Math.floor((now - r.start) / FRAME_MS);
      if (i < r.frames.length) pose = { ...pose, eyes: undefined, ...r.frames[i] };
      else l.reaction = null;
    }
  }

  const rows = niloFrame(pose).slice(0, crop === "face" ? 12 : NILO_CANVAS.h);
  const svg = (
    <svg
      ref={svgRef}
      role={interactive || !label ? undefined : "img"}
      aria-label={interactive ? undefined : label}
      aria-hidden={interactive || !label ? true : undefined}
      viewBox={`0 0 ${NILO_CANVAS.w} ${rows.length}`}
      width={NILO_CANVAS.w * cell}
      height={rows.length * cell}
      shapeRendering="crispEdges"
      className={interactive ? "block" : className}
    >
      {cellPaths(rows).map(([fill, d]) => (
        <path key={fill} fill={fill} d={d} />
      ))}
    </svg>
  );
  if (!interactive) return svg;

  const onClick = () => {
    if (l.still) return;
    const at = performance.now();
    l.lastActive = at;
    l.clicks = l.clicks.filter((c) => at - c < 1500).concat(at);
    const name = l.clicks.length >= 5 ? "dizzy" : PICKS[Math.floor(Math.random() * PICKS.length)];
    if (name === "dizzy") l.clicks = [];
    l.reaction = { frames: REACTIONS[name], start: at };
    if (name === "hoot" || name === "dizzy") {
      setBubble(name === "dizzy" ? "@_@" : "hoo!");
      window.setTimeout(() => setBubble(null), 900);
    }
  };

  return (
    <button type="button" onClick={onClick} aria-label={label ?? "Nilo"} className={`relative cursor-pointer ${className}`}>
      {svg}
      {bubble && (
        <span className="oh-nilo-bubble" aria-hidden>
          {bubble}
        </span>
      )}
    </button>
  );
}
