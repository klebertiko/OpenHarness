"use client";

import { open } from "@tauri-apps/plugin-dialog";

/**
 * Whether the native OS dialog is actually reachable right now. `false` in
 * the plain browser dev preview (no `__TAURI_INTERNALS__`) — calling `open()`
 * there would just hang against a host that never answers the IPC call, so
 * callers check this first and say so, rather than the picker silently doing
 * nothing when clicked.
 */
export function nativeDialogAvailable(): boolean {
  if (typeof window === "undefined") return false;
  const g = window as unknown as { __TAURI_INTERNALS__?: { invoke?: unknown } };
  return typeof g.__TAURI_INTERNALS__?.invoke === "function";
}

/**
 * Native folder picker (desktop shell only — check `nativeDialogAvailable()`
 * first). `null` means the person cancelled, or the dialog itself failed;
 * the composer's "No folder" state already covers that honestly, so this
 * never throws.
 */
export async function pickFolder(): Promise<string | null> {
  if (!nativeDialogAvailable()) return null;
  try {
    const selected = await open({ directory: true, multiple: false, canCreateDirectories: true });
    return typeof selected === "string" ? selected : null;
  } catch {
    return null;
  }
}
