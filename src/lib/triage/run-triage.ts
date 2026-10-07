import type { Db } from "@/lib/db";
import type { Judgment, JudgmentProvider } from "@/lib/judgment/provider";
import type { TriageResult } from "@/lib/policy";

import { currentPolicy } from "@/lib/policies";
import { triage } from "@/lib/policy";

import type { Answers } from "./parse-judgment";
import type { TicketInput } from "./state";

import { findCandidates } from "./candidates";
import { loadContexts } from "./context";

// Triage of one ticket (plan M4): find duplicate candidates, ask the judgment
// provider once, store the judgment raw, link the ticket to Jev's duplicate
// pick, then let the policy decide with the facts the model never sees
// (ADR-0001). A triage is only written if its judgment covers at least as
// many messages as the ticket has, so a late, stale judgment never overwrites
// a newer triage.

export type TriageOutcome =
  /** The ticket is gone, or it has more messages than this job: a newer job judges it. */
  | { status: "missing" | "superseded"; ticketId: string }
  /** "stale": judged, but more messages arrived meanwhile, so the triage wasn't written. */
  | {
      status: "triaged" | "stale";
      ticketId: string;
      judgmentId: string;
      /** Issues whose links (and so whose demand) changed. */
      changedIssueIds: string[];
      result: TriageResult | null;
    };

export type JudgmentOrigin = "live" | "eval";

export async function triageTicket(
  { db: database, provider }: { db: Db; provider: JudgmentProvider },
  { ticketId, messageCount }: { ticketId: string; messageCount: number },
  options?: { signal?: AbortSignal },
): Promise<TriageOutcome> {
  const ticket = await database.ticket.findUnique({
    where: { id: ticketId },
    include: { workspace: true, messages: { orderBy: { position: "asc" } } },
  });
  if (!ticket) return { status: "missing", ticketId };
  if (ticket.messages.length > messageCount) return { status: "superseded", ticketId };

  const input: TicketInput = {
    subject: ticket.subject,
    messages: ticket.messages.map(({ from, text }) => ({
      from: from === "support" ? "support" : "customer",
      text,
    })),
  };
  const candidates = await findCandidates(database, {
    tracker: ticket.workspace.tracker,
    ticket: input,
    before: ticket.createdAt,
    excludeIssueId: ticket.sourceIssueId,
  });
  const judgment = await provider.judge({ ticket: input, candidates }, options);
  const judgmentId = await storeJudgment(database, ticketId, judgment, "live");
  return applyJudgment(database, {
    ticketId,
    judgmentId,
    answers: judgment.answers,
    messageCount: judgment.messageCount,
  });
}

export async function storeJudgment(
  database: Db,
  ticketId: string,
  judgment: Judgment,
  origin: JudgmentOrigin,
): Promise<string> {
  const { id } = await database.judgment.create({
    data: {
      ticketId,
      provider: judgment.provider,
      model: judgment.model,
      requestId: judgment.requestId,
      questionSetVersion: judgment.questionSetVersion,
      messageCount: judgment.messageCount,
      state: judgment.state,
      candidateMap: judgment.candidateMap,
      answers: judgment.answers,
      inputTokens: judgment.usage.inputTokens,
      outputTokens: judgment.usage.outputTokens,
      origin,
    },
    select: { id: true },
  });
  return id;
}

/** Links the ticket to Jev's pick and writes the policy's triage for a stored judgment. */
export async function applyJudgment(
  database: Db,
  {
    ticketId,
    judgmentId,
    answers,
    messageCount,
  }: { ticketId: string; judgmentId: string; answers: Answers; messageCount: number },
): Promise<Exclude<TriageOutcome, { status: "missing" | "superseded" }>> {
  const current = await database.message.count({ where: { ticketId } });
  if (current > messageCount) {
    return { status: "stale", ticketId, judgmentId, changedIssueIds: [], result: null };
  }

  const policy = await currentPolicy(database);
  const pick = answers.duplicate;
  const linkTo =
    pick?.issueId && pick.probability >= policy.values.minDuplicateProbability
      ? pick.issueId
      : null;
  const changedIssueIds = await setJevLink(database, ticketId, linkTo);

  const ticket = await database.ticket.findUniqueOrThrow({
    where: { id: ticketId },
    include: { workspace: true, links: true },
  });
  const contexts = await loadContexts(database, [
    {
      id: ticket.id,
      createdAt: ticket.createdAt,
      plan: ticket.workspace.plan,
      tracker: ticket.workspace.tracker,
      answers,
      linkedIssueIds: ticket.links.map(({ issueId }) => issueId),
    },
  ]);
  const context = contexts.get(ticket.id);
  if (!context) throw new Error(`No context for ticket ${ticket.id}`);
  const result = triage(answers, context, policy.values);

  const written = await writeTriage(database, {
    ticketId,
    judgmentId,
    messageCount,
    policyVersion: policy.version,
    result,
  });
  return { status: written ? "triaged" : "stale", ticketId, judgmentId, changedIssueIds, result };
}

/**
 * Inserts or replaces a ticket's triage in one statement, unless the ticket
 * has more messages than the judgment covers or its triage already covers
 * more. Returns whether a row was written.
 */
export async function writeTriage(
  database: Db,
  {
    ticketId,
    judgmentId,
    messageCount,
    policyVersion,
    result,
  }: {
    ticketId: string;
    judgmentId: string;
    messageCount: number;
    policyVersion: number;
    result: TriageResult;
  },
): Promise<boolean> {
  const rows = await database.$executeRaw`
    INSERT INTO "Triage" ("ticketId", "judgmentId", "messageCount", "policyVersion", "priority",
      "ruleFired", "needsReview", "reviewReasons", "squad", "trace", "updatedAt")
    SELECT ${ticketId}, ${judgmentId}, ${messageCount}, ${policyVersion}, ${result.priority},
      ${result.ruleFired}, ${result.needsReview}, ${result.reviewReasons}::text[], ${result.squad},
      ${JSON.stringify(result.trace)}::jsonb, now()
    WHERE (SELECT count(*) FROM "Message" WHERE "ticketId" = ${ticketId}) <= ${messageCount}
    ON CONFLICT ("ticketId") DO UPDATE SET
      "judgmentId" = EXCLUDED."judgmentId",
      "messageCount" = EXCLUDED."messageCount",
      "policyVersion" = EXCLUDED."policyVersion",
      "priority" = EXCLUDED."priority",
      "ruleFired" = EXCLUDED."ruleFired",
      "needsReview" = EXCLUDED."needsReview",
      "reviewReasons" = EXCLUDED."reviewReasons",
      "squad" = EXCLUDED."squad",
      "trace" = EXCLUDED."trace",
      "updatedAt" = now()
    WHERE "Triage"."messageCount" <= EXCLUDED."messageCount"
  `;
  return rows > 0;
}

/**
 * Makes `issueId` the ticket's only link from Jev (a person's links stay).
 * Returns the issues whose links changed.
 */
export async function setJevLink(
  database: Db,
  ticketId: string,
  issueId: string | null,
): Promise<string[]> {
  const existing = await database.ticketIssueLink.findMany({ where: { ticketId } });
  const stale = existing.filter((link) => link.origin === "jev" && link.issueId !== issueId);
  const add = issueId !== null && !existing.some((link) => link.issueId === issueId);

  if (stale.length > 0) {
    await database.ticketIssueLink.deleteMany({
      where: { ticketId, issueId: { in: stale.map((link) => link.issueId) } },
    });
  }
  if (add) await database.ticketIssueLink.create({ data: { ticketId, issueId, origin: "jev" } });
  return [...stale.map((link) => link.issueId), ...(add ? [issueId] : [])];
}
