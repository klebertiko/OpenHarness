import type { Connection } from "@/components/providers/providerStore";

/**
 * True only when a node's pinned connection is real evidence of diverging
 * from what the chat composer would use today — never just "different from
 * nothing". Both sides must be concrete:
 *  - `connectionId` unset means the segment never resolved one at all (the
 *    harness-off `/execute/direct` path never sets it — see Segment's own
 *    doc comment in ./types.ts), so there is nothing to compare.
 *  - an unresolvable `defaultConnectionId` (nothing enabled/connected for
 *    `pickChatProvider` to land on) means there is no honest "today's
 *    default" to diverge from either — flagging every pinned node against
 *    a non-existent default would be noise, not signal.
 */
export function isPinnedMismatch(
  connectionId: string | undefined,
  defaultConnectionId: string | null | undefined
): boolean {
  return Boolean(connectionId) && Boolean(defaultConnectionId) && connectionId !== defaultConnectionId;
}

/**
 * Human label for a pinned connection id. Falls back to the raw id so a
 * badge never goes blank just because the connection was since removed
 * under Providers — the run still really did use it.
 */
export function connectionLabel(connections: Connection[], connectionId: string): string {
  return connections.find((c) => c.id === connectionId)?.label ?? connectionId;
}
