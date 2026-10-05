import type { TriageContext } from "@/lib/policy";
import type { Policy } from "@/lib/policy-schema";
import type { TriagePriority } from "@/lib/priorities";
import type { Answers } from "@/lib/triage/parse-judgment";

import { triage } from "@/lib/policy";

// Which tickets a policy change would move, computed from stored answers with
// no model calls (ADR-0001). The policy editor previews this before saving,
// and the recompute after saving must move exactly these tickets. A ticket a
// person set a priority for never moves.

export type PolicyRow = {
  ticketId: string;
  answers: Answers;
  ctx: TriageContext;
  /** Set when a person chose the priority; recompute leaves those tickets alone. */
  humanPriority: TriagePriority | null;
};

export type Move = { ticketId: string; from: TriagePriority; to: TriagePriority };

export type PolicyDiff = {
  /** Rows a policy decides, i.e. without a human priority. */
  compared: number;
  skippedHumanSet: number;
  moved: Move[];
  /** Counts of every compared row by its priority under each policy; the diagonal is unchanged rows. */
  matrix: Record<TriagePriority, Record<TriagePriority, number>>;
};

function emptyRow(): Record<TriagePriority, number> {
  return { urgent: 0, high: 0, medium: 0, low: 0, wont_do: 0 };
}

export function diffPolicies(rows: readonly PolicyRow[], from: Policy, to: Policy): PolicyDiff {
  const matrix = {
    urgent: emptyRow(),
    high: emptyRow(),
    medium: emptyRow(),
    low: emptyRow(),
    wont_do: emptyRow(),
  };
  const moved: Move[] = [];
  let compared = 0;

  for (const { ticketId, answers, ctx, humanPriority } of rows) {
    if (humanPriority !== null) continue;
    compared++;
    const before = triage(answers, ctx, from).priority;
    const after = triage(answers, ctx, to).priority;
    matrix[before][after]++;
    if (before !== after) moved.push({ ticketId, from: before, to: after });
  }

  return { compared, skippedHumanSet: rows.length - compared, moved, matrix };
}
