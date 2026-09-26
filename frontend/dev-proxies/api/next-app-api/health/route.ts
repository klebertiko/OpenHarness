import { NextResponse } from "next/server";

/**
 * Backend liveness, proxied.
 *
 * The status bar needs to know whether the engine is up. Asking the browser to
 * poll the FastAPI process directly means a CORS preflight plus a red
 * ERR_CONNECTION_REFUSED in the console every few seconds while it is down —
 * which is the normal state during frontend work. Ask from the server instead:
 * the renderer gets a clean 200 with `{ ok: false }` and stays quiet.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const base = process.env.API_URL ?? "http://127.0.0.1:8000";
  try {
    const res = await fetch(`${base}/health`, {
      cache: "no-store",
      signal: AbortSignal.timeout(1500),
    });
    return NextResponse.json({ ok: res.ok, base });
  } catch {
    return NextResponse.json({ ok: false, base });
  }
}
