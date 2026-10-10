import type { Block, ToolCall } from "./types";

/**
 * Activity summaries for the transcript ("Ran 3 commands · Read 2 files").
 *
 * Pure seam, no React: consecutive tool blocks inside ONE segment's `blocks`
 * collapse into an `ActivityGroup`, and `summarizeCalls` turns any list of
 * calls into the one-line, count-by-verb label. Grouping is per block list, so
 * a group can never cross a step (segment) boundary by construction.
 */

export type ActivityVerb = "ran" | "read" | "searched" | "listed" | "edited" | "other";

/** Display order of verbs in a summary line (stable, not first-seen). */
const VERB_ORDER: ActivityVerb[] = ["ran", "read", "searched", "listed", "edited", "other"];

const VERB_BY_TOOL: Record<string, ActivityVerb> = {
  exec: "ran",
  run_command: "ran",
  shell: "ran",
  bash: "ran",
  read: "read",
  read_file: "read",
  grep: "searched",
  search: "searched",
  glob: "searched",
  find: "searched",
  discover: "listed",
  list_workspace: "listed",
  ls: "listed",
  write: "edited",
  write_file: "edited",
  edit: "edited",
  edit_file: "edited",
  apply_patch: "edited",
};

export function classifyTool(name: string): ActivityVerb {
  return VERB_BY_TOOL[name] ?? "other";
}

/** Two or more consecutive tool calls inside one step. */
export interface ActivityGroup {
  kind: "activity";
  calls: ToolCall[];
}

/**
 * Collapse runs of 2+ consecutive `tool` blocks into one group. A lone tool
 * call, and every reason/text block, passes through untouched; text or
 * reasoning between calls ends the run (the answer must stay readable in order).
 */
export function groupActivity(blocks: Block[]): Array<Block | ActivityGroup> {
  const out: Array<Block | ActivityGroup> = [];
  let run: Block[] = [];
  const flush = () => {
    if (run.length === 1) out.push(run[0]);
    else if (run.length > 1) {
      out.push({
        kind: "activity",
        calls: run.map((b) => (b as Extract<Block, { kind: "tool" }>).call),
      });
    }
    run = [];
  };
  for (const b of blocks) {
    if (b.kind === "tool") run.push(b);
    else {
      flush();
      out.push(b);
    }
  }
  flush();
  return out;
}

export interface ActivitySummary {
  /** "Ran 3 commands · Read 2 files · 1 failed" */
  label: string;
  counts: Partial<Record<ActivityVerb, number>>;
  total: number;
  /** At least one call has not produced a result yet. */
  running: boolean;
  failed: number;
  /** A call is parked on the approval gate with no decision yet. */
  awaitingApproval: boolean;
  /** Live line for the in-flight call ("Running npm test…"), else null. */
  current: string | null;
}

const NOUN: Record<ActivityVerb, [string, string, string]> = {
  ran: ["Ran", "command", "commands"],
  read: ["Read", "file", "files"],
  searched: ["Searched", "time", "times"],
  listed: ["Listed", "folder", "folders"],
  edited: ["Edited", "file", "files"],
  other: ["Used", "tool", "tools"],
};

function phrase(verb: ActivityVerb, n: number, onlyOther: boolean): string {
  const [lead, one, many] = NOUN[verb];
  const noun = n === 1 ? one : many;
  return verb === "other" && !onlyOther ? `${lead} ${n} other ${noun}` : `${lead} ${n} ${noun}`;
}

function isFailed(c: ToolCall): boolean {
  return c.ok === false || c.denied !== undefined;
}
function isPending(c: ToolCall): boolean {
  return c.ok === undefined && c.denied === undefined;
}
function isAwaiting(c: ToolCall): boolean {
  return c.approval !== undefined && c.approval.decision === undefined && isPending(c);
}

const TARGET_MAX = 60;
function target(c: ToolCall): string {
  const raw = c.argv?.length ? c.argv.join(" ") : (c.path ?? c.args);
  return raw.length > TARGET_MAX ? `${raw.slice(0, TARGET_MAX - 1)}…` : raw;
}

const PROGRESSIVE: Record<ActivityVerb, string> = {
  ran: "Running",
  read: "Reading",
  searched: "Searching",
  listed: "Listing",
  edited: "Editing",
  other: "Using",
};

function describeCurrent(c: ToolCall): string {
  const t = target(c);
  if (isAwaiting(c)) return `Waiting for approval: ${t || c.name}`;
  const verb = classifyTool(c.name);
  const subject = verb === "other" ? c.name : t;
  return `${PROGRESSIVE[verb]} ${subject}…`.replace("  ", " ");
}

export function summarizeCalls(calls: ToolCall[]): ActivitySummary {
  const counts: Partial<Record<ActivityVerb, number>> = {};
  for (const c of calls) {
    const v = classifyTool(c.name);
    counts[v] = (counts[v] ?? 0) + 1;
  }
  const onlyOther = Object.keys(counts).length === 1 && counts.other !== undefined;
  const parts = VERB_ORDER.filter((v) => counts[v]).map((v) => phrase(v, counts[v]!, onlyOther));
  const failed = calls.filter(isFailed).length;
  if (failed > 0) parts.push(`${failed} failed`);

  const pending = calls.filter(isPending);
  const awaiting = calls.filter(isAwaiting);
  const live = awaiting[0] ?? pending[pending.length - 1];

  return {
    label: parts.join(" · "),
    counts,
    total: calls.length,
    running: pending.length > 0,
    failed,
    awaitingApproval: awaiting.length > 0,
    current: live ? describeCurrent(live) : null,
  };
}

export function summarizeGroup(group: ActivityGroup): ActivitySummary {
  return summarizeCalls(group.calls);
}

/**
 * Step-header summary: the whole step's tool activity in one line. Returns
 * null when it would only repeat what is already on screen — no tools, or a
 * single activity item with nothing failed — so the header adds information
 * instead of echoing the group line below it.
 */
export function segmentActivity(blocks: Block[]): ActivitySummary | null {
  const calls = blocks.flatMap((b) => (b.kind === "tool" ? [b.call] : []));
  if (calls.length === 0) return null;
  const items = groupActivity(blocks).filter((x) => x.kind === "activity" || x.kind === "tool").length;
  const summary = summarizeCalls(calls);
  if (items === 1 && summary.failed === 0) return null;
  return summary;
}
