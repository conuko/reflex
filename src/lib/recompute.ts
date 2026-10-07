import type { Db } from "@/lib/db";
import type { TriageContext } from "@/lib/policy";
import type { Policy } from "@/lib/policy-schema";
import type { TriagePriority } from "@/lib/priorities";
import type { Answers } from "@/lib/triage/parse-judgment";

import { currentPolicy } from "@/lib/policies";
import { triage } from "@/lib/policy";
import { TRIAGE_PRIORITIES } from "@/lib/priorities";
import { loadContexts, storedAnswers } from "@/lib/triage/context";
import { writeTriage } from "@/lib/triage/run-triage";

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

// ---- Recompute from stored judgments ----

/** Tickets per chunk when recomputing. */
export const RECOMPUTE_CHUNK = 500;

export type StoredTriageRow = PolicyRow & {
  judgmentId: string;
  messageCount: number;
  stored: {
    priority: string;
    ruleFired: string;
    needsReview: boolean;
    reviewReasons: string[];
    squad: string;
    policyVersion: number;
  };
};

/** Policy rows for triaged tickets in id order, `take` at a time after `after`, with their contexts. */
export async function loadPolicyRows(
  database: Db,
  { ticketIds, after, take }: { ticketIds?: readonly string[]; after?: string; take?: number } = {},
): Promise<StoredTriageRow[]> {
  const triages = await database.triage.findMany({
    where: {
      ...(ticketIds && { ticketId: { in: [...ticketIds] } }),
      ...(after !== undefined && { AND: { ticketId: { gt: after } } }),
    },
    orderBy: { ticketId: "asc" },
    ...(take !== undefined && { take }),
    include: {
      judgment: { select: { answers: true } },
      ticket: {
        select: {
          createdAt: true,
          humanPriority: true,
          workspace: { select: { plan: true, tracker: true } },
          links: { select: { issueId: true } },
        },
      },
    },
  });
  const tickets = triages.map((row) => ({
    id: row.ticketId,
    createdAt: row.ticket.createdAt,
    plan: row.ticket.workspace.plan,
    tracker: row.ticket.workspace.tracker,
    answers: storedAnswers.parse(row.judgment.answers),
    linkedIssueIds: row.ticket.links.map(({ issueId }) => issueId),
  }));
  const contexts = await loadContexts(database, tickets);

  return triages.map((row, index) => {
    const ticket = tickets[index];
    const ctx = contexts.get(row.ticketId);
    if (!ticket || !ctx) throw new Error(`No context for ticket ${row.ticketId}`);
    return {
      ticketId: row.ticketId,
      answers: ticket.answers,
      ctx,
      humanPriority: priorityOf(row.ticket.humanPriority),
      judgmentId: row.judgmentId,
      messageCount: row.messageCount,
      stored: {
        priority: row.priority,
        ruleFired: row.ruleFired,
        needsReview: row.needsReview,
        reviewReasons: row.reviewReasons,
        squad: row.squad,
        policyVersion: row.policyVersion,
      },
    };
  });
}

export type RecomputeOutcome = {
  compared: number;
  skippedHumanSet: number;
  /** Rows whose triage changed in any way, including only the policy version. */
  updated: number;
  /** Rows whose priority changed. */
  moved: Move[];
};

/**
 * Recomputes triages from stored judgments with the current policy, in chunks
 * of 500, with no model calls (ADR-0001). Tickets a person set a priority for
 * are left alone.
 */
export async function recomputeTriages(
  database: Db,
  { ticketIds }: { ticketIds?: readonly string[] } = {},
): Promise<RecomputeOutcome> {
  const policy = await currentPolicy(database);
  const outcome: RecomputeOutcome = { compared: 0, skippedHumanSet: 0, updated: 0, moved: [] };

  for (let after: string | undefined; ;) {
    // oxlint-disable-next-line eslint/no-await-in-loop
    const rows = await loadPolicyRows(database, { ticketIds, after, take: RECOMPUTE_CHUNK });
    for (const row of rows) {
      if (row.humanPriority !== null) {
        outcome.skippedHumanSet++;
        continue;
      }
      outcome.compared++;
      const result = triage(row.answers, row.ctx, policy.values);
      const same =
        result.priority === row.stored.priority &&
        result.ruleFired === row.stored.ruleFired &&
        result.needsReview === row.stored.needsReview &&
        result.squad === row.stored.squad &&
        result.reviewReasons.join() === row.stored.reviewReasons.join() &&
        policy.version === row.stored.policyVersion;
      if (same) continue;
      // oxlint-disable-next-line eslint/no-await-in-loop
      await writeTriage(database, {
        ticketId: row.ticketId,
        judgmentId: row.judgmentId,
        messageCount: row.messageCount,
        policyVersion: policy.version,
        result,
      });
      outcome.updated++;
      const from = priorityOf(row.stored.priority);
      if (from !== null && from !== result.priority) {
        outcome.moved.push({ ticketId: row.ticketId, from, to: result.priority });
      }
    }
    const last = rows.at(-1);
    if (rows.length < RECOMPUTE_CHUNK || !last) break;
    after = last.ticketId;
  }
  return outcome;
}

function priorityOf(value: string | null): TriagePriority | null {
  return TRIAGE_PRIORITIES.find((priority) => priority === value) ?? null;
}
