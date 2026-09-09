"use client";
import { use } from "react";
import { ASSIGN } from "../assign";
import CanvasBench from "../../canvas/page";

/**
 * Blind comparison slot. Both candidates are served from this one origin and
 * this one route shape so nothing outside the rendered pixels distinguishes
 * them.
 */
export default function Slot({ params }: { params: Promise<{ slot: string }> }) {
  const { slot } = use(params);
  const which = ASSIGN[slot];

  if (which === "live") return <CanvasBench />;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "#0d0f13",
        display: "grid",
        placeItems: "center",
        overflow: "hidden",
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/ref/bar.png"
        alt=""
        style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }}
      />
    </div>
  );
}
