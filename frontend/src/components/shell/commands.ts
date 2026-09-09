import type { LucideIcon } from "lucide-react";

/**
 * One command = one thing a person can ask the app to do.
 *
 * The palette is the canonical index of the application's verbs. If an action
 * exists only as a button, it is a bug: the button is a shortcut to a command,
 * never the only way in.
 */
export interface Command {
  id: string;
  /** Human-written, imperative. "Run harness", not "Running the harness". */
  label: string;
  /** Grouping kicker shown once per run of commands. */
  group: string;
  icon: LucideIcon;
  /** Chord spec understood by keys.ts, e.g. "Mod+Enter". */
  chord?: string;
  /** Machine-side detail shown mono at the right: adapter, node type, id. */
  meta?: string;
  /** Extra substrings the matcher should accept. */
  keywords?: string;
  role?: string;
  disabled?: boolean;
  run: () => void;
}

export interface Match {
  command: Command;
  score: number;
  /** Index pairs into `label` that matched, for highlighting. */
  hits: number[];
}

/**
 * Subsequence matcher, scored on how *early* and how *contiguously* the query
 * lands. Deliberately not a fuzzy library: on a command set this size a real
 * fuzzy ranker mostly produces surprising order, and surprise is the one thing
 * a palette cannot afford — the same query must always yield the same top row.
 */
export function matchCommands(commands: Command[], query: string): Match[] {
  const q = query.trim().toLowerCase();
  if (!q) {
    return commands.map((command, i) => ({ command, score: 1000 - i, hits: [] }));
  }

  const out: Match[] = [];
  for (const command of commands) {
    const hay = command.label.toLowerCase();
    const extra = `${command.group} ${command.meta ?? ""} ${command.keywords ?? ""}`.toLowerCase();

    const direct = hay.indexOf(q);
    if (direct >= 0) {
      out.push({
        command,
        score: 1000 - direct * 8 - (hay.length - q.length),
        hits: Array.from({ length: q.length }, (_, k) => direct + k),
      });
      continue;
    }

    // Subsequence over the label.
    const hits: number[] = [];
    let qi = 0;
    let gaps = 0;
    let last = -1;
    for (let i = 0; i < hay.length && qi < q.length; i++) {
      if (hay[i] === q[qi]) {
        if (last >= 0 && i !== last + 1) gaps++;
        hits.push(i);
        last = i;
        qi++;
      }
    }
    if (qi === q.length) {
      out.push({ command, score: 600 - gaps * 20 - hits[0] * 3, hits });
      continue;
    }

    if (extra.includes(q)) out.push({ command, score: 200, hits: [] });
  }

  return out.sort((a, b) => b.score - a.score);
}
