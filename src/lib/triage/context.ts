import { z } from "zod";

import type { Plan } from "@/lib/config/plans";
import type { Db } from "@/lib/db";
import type { TriageContext } from "@/lib/policy";

import { PLANS } from "@/lib/config/plans";
import { issueDemand } from "@/lib/demand";
import { groupKey, SPIKE_RULES } from "@/lib/spike";

import type { Answers } from "./parse-judgment";

// The facts the policy gets next to a judgment, which the model never sees
// (ADR-0001): the workspace's plan, whether an incident is open for the
// ticket's group, and the demand on the issue the ticket is linked to. Loaded
// for many tickets at once, so a recompute of 500 tickets is a few queries.

/** A ticket as the context loader needs it. */
export type ContextTicket = {
  id: string;
  createdAt: Date;
  plan: string;
  tracker: string;
  answers: Answers;
  linkedIssueIds: readonly string[];
};

export async function loadContexts(
  database: Db,
  tickets: readonly ContextTicket[],
): Promise<Map<string, TriageContext>> {
  const incidents = await database.incident.findMany({ where: { closedAt: null } });
  const openSince = new Map(
    incidents.map(({ groupKey: key, windowStart }) => [
      key,
      windowStart.getTime() - SPIKE_RULES.windowMinutes * 60_000,
    ]),
  );
  const linked = [...new Set(tickets.flatMap(({ linkedIssueIds }) => linkedIssueIds))];
  const demand = new Map(
    linked.length === 0
      ? []
      : (await issueDemand(database, { issueIds: linked })).map((each) => [each.issueId, each]),
  );

  return new Map(
    tickets.map((ticket) => {
      const since = openSince.get(groupKey(ticket.answers, ticket.tracker));
      const linkedDemand = ticket.linkedIssueIds.flatMap((id) => demand.get(id) ?? []);
      return [
        ticket.id,
        {
          plan: planOf(ticket.plan),
          spikeActive: since !== undefined && ticket.createdAt.getTime() >= since,
          demand: {
            workspaces: Math.max(0, ...linkedDemand.map(({ workspaces }) => workspaces)),
            arr: Math.max(0, ...linkedDemand.map(({ arr }) => arr)),
          },
        },
      ];
    }),
  );
}

function planOf(plan: string): Plan {
  return PLANS.find((each) => each === plan) ?? "free";
}

/** Answers as stored on a judgment; written by this app from a parsed judgment, so only the shape is checked. */
export const storedAnswers = z.custom<Answers>(
  (value) =>
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    "area" in value &&
    "nonGoals" in value,
  "not a stored judgment's answers",
);
