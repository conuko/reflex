import { z } from "zod";

import type { Plan } from "@/lib/config/plans";
import type { Db } from "@/lib/db";
import type { IssueDemand } from "@/lib/demand";
import type { TraceStep } from "@/lib/policy";
import type { Policy } from "@/lib/policy-schema";
import type { TriagePriority } from "@/lib/priorities";
import type { Answers } from "@/lib/triage/parse-judgment";

import { issueDemand } from "@/lib/demand";
import { policySchema } from "@/lib/policy-schema";
import { storedAnswers } from "@/lib/triage/context";
import { NO_DUPLICATE } from "@/lib/triage/questions";

import { planOf, priorityOf } from "./inbox";

// One ticket for the detail panel (plan M5): the thread, the triage with its
// trace and the policy version that made it, Jev's answers, the duplicate
// candidates Jev chose from, links and their demand, and every correction.
// Served as JSON by /api/tickets/[id], so dates are ISO strings.

export type TicketDetail = {
  id: string;
  externalId: string;
  subject: string;
  source: string;
  createdAt: string;
  workspace: { id: string; name: string; plan: Plan; tracker: string; seats: number; arr: number };
  messages: { position: number; from: string; text: string; createdAt: string }[];
  priority: TriagePriority | null;
  suggested: TriagePriority | null;
  humanSet: boolean;
  accepted: boolean;
  triaging: boolean;
  triage: {
    priority: TriagePriority | null;
    ruleFired: string;
    needsReview: boolean;
    reviewReasons: string[];
    squad: string;
    trace: TraceStep[];
    policyVersion: number;
    policy: Policy;
    messageCount: number;
    previousPriority: TriagePriority | null;
    priorityChangedAt: string | null;
    updatedAt: string;
  } | null;
  /** The judgment the triage was made from. */
  judgment: {
    id: string;
    provider: string;
    model: string;
    origin: string;
    messageCount: number;
    inputTokens: number;
    createdAt: string;
    answers: Answers;
  } | null;
  /** Every judgment of the ticket, oldest first: one per message count Jev saw. */
  judgments: { id: string; messageCount: number; createdAt: string; answers: Answers }[];
  /** The existing issues Jev was offered, most likely first. */
  candidates: { key: string; issueId: string; title: string; probability: number }[];
  /** Jev's probability that the ticket duplicates none of the candidates. */
  noneProbability: number | null;
  links: { issueId: string; title: string; origin: string; source: string }[];
  demand: IssueDemand[];
  corrections: { field: string; fromValue: string | null; toValue: string; createdAt: string }[];
};

// Written by this app from the policy's result, so only the shape is checked.
const storedTrace = z.custom<TraceStep[]>((value) => Array.isArray(value), "not a trace");
const candidateMap = z.record(z.string(), z.string());

export async function ticketDetail(
  database: Db,
  id: string,
  { now = new Date() }: { now?: Date } = {},
): Promise<TicketDetail | null> {
  const ticket = await database.ticket.findUnique({
    where: { id },
    include: {
      workspace: true,
      messages: { orderBy: { position: "asc" } },
      triage: { include: { judgment: true } },
      judgments: { orderBy: [{ messageCount: "asc" }, { createdAt: "asc" }] },
      links: {
        include: { issue: { select: { title: true, source: true } } },
        orderBy: { createdAt: "asc" },
      },
      corrections: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!ticket) return null;

  const { triage } = ticket;
  const judgment = triage?.judgment ?? null;
  const answers = judgment ? storedAnswers.parse(judgment.answers) : null;
  const [policy, candidates, demand] = await Promise.all([
    triage ? database.policy.findUnique({ where: { version: triage.policyVersion } }) : null,
    judgment && answers
      ? loadCandidates(database, candidateMap.parse(judgment.candidateMap), answers)
      : [],
    ticket.links.length > 0
      ? issueDemand(database, { issueIds: ticket.links.map(({ issueId }) => issueId), now })
      : [],
  ]);
  const suggested = priorityOf(triage?.priority ?? null);
  const human = priorityOf(ticket.humanPriority);

  return {
    id: ticket.id,
    externalId: ticket.externalId,
    subject: ticket.subject,
    source: ticket.source,
    createdAt: ticket.createdAt.toISOString(),
    workspace: { ...ticket.workspace, plan: planOf(ticket.workspace.plan) },
    messages: ticket.messages.map(({ position, from, text, createdAt }) => ({
      position,
      from,
      text,
      createdAt: createdAt.toISOString(),
    })),
    priority: human ?? suggested,
    suggested,
    humanSet: human !== null,
    accepted: ticket.acceptedAt !== null,
    triaging: !triage || triage.messageCount < ticket.messages.length,
    triage:
      triage && policy
        ? {
            priority: suggested,
            ruleFired: triage.ruleFired,
            needsReview: triage.needsReview,
            reviewReasons: triage.reviewReasons,
            squad: triage.squad,
            trace: storedTrace.parse(triage.trace),
            policyVersion: triage.policyVersion,
            policy: policySchema.parse(policy.values),
            messageCount: triage.messageCount,
            previousPriority: priorityOf(triage.previousPriority),
            priorityChangedAt: triage.priorityChangedAt?.toISOString() ?? null,
            updatedAt: triage.updatedAt.toISOString(),
          }
        : null,
    judgment:
      judgment && answers
        ? {
            id: judgment.id,
            provider: judgment.provider,
            model: judgment.model,
            origin: judgment.origin,
            messageCount: judgment.messageCount,
            inputTokens: judgment.inputTokens,
            createdAt: judgment.createdAt.toISOString(),
            answers,
          }
        : null,
    judgments: ticket.judgments.map((each) => ({
      id: each.id,
      messageCount: each.messageCount,
      createdAt: each.createdAt.toISOString(),
      answers: storedAnswers.parse(each.answers),
    })),
    candidates,
    noneProbability: answers?.duplicate?.probabilities[NO_DUPLICATE] ?? null,
    links: ticket.links.map(({ issueId, origin, issue }) => ({
      issueId,
      title: issue.title,
      origin,
      source: issue.source,
    })),
    demand,
    corrections: ticket.corrections.map(({ field, fromValue, toValue, createdAt }) => ({
      field,
      fromValue,
      toValue,
      createdAt: createdAt.toISOString(),
    })),
  };
}

async function loadCandidates(
  database: Db,
  map: Record<string, string>,
  answers: Answers,
): Promise<TicketDetail["candidates"]> {
  const ids = Object.values(map);
  if (ids.length === 0) return [];
  const titles = new Map(
    (
      await database.issue.findMany({
        where: { id: { in: ids } },
        select: { id: true, title: true },
      })
    ).map(({ id, title }) => [id, title]),
  );
  const probabilities = answers.duplicate?.probabilities ?? {};
  return Object.entries(map)
    .map(([key, issueId]) => ({
      key,
      issueId,
      title: titles.get(issueId) ?? "",
      probability: probabilities[key] ?? 0,
    }))
    .toSorted((a, b) => b.probability - a.probability);
}
