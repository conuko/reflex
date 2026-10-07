import type { Plan } from "@/lib/config/plans";
import type { Db } from "@/lib/db";
import type { IssueDemand } from "@/lib/demand";

import { issueDemand } from "@/lib/demand";
import { NON_GOAL_DESCRIPTIONS } from "@/lib/labels";
import { storedAnswers } from "@/lib/triage/context";

import { planOf } from "./inbox";

// The feature demand page (plan M5): the M4 aggregate per linked issue, and
// the Won't-do requests grouped by the non-goal they ask for, with how much
// ARR asks for each.

export type DemandIssue = IssueDemand & { title: string; tracker: string; source: string };

export type WontDoGroup = {
  nonGoal: string;
  label: string;
  what: string;
  tickets: {
    id: string;
    subject: string;
    workspace: string;
    plan: Plan;
    arr: number;
    probability: number;
    createdAt: string;
  }[];
  workspaces: number;
  /** Combined ARR of the asking workspaces, each counted once. */
  arr: number;
};

export type DemandOverview = { issues: DemandIssue[]; wontDo: WontDoGroup[] };

export async function demandOverview(
  database: Db,
  { now = new Date() }: { now?: Date } = {},
): Promise<DemandOverview> {
  const demand = await issueDemand(database, { now });
  const issues = await database.issue.findMany({
    where: { id: { in: demand.map(({ issueId }) => issueId) } },
    select: { id: true, title: true, tracker: true, source: true },
  });
  const byId = new Map(issues.map((issue) => [issue.id, issue]));

  const declined = await database.triage.findMany({
    where: {
      ruleFired: "non_goal",
      ticket: { OR: [{ humanPriority: null }, { humanPriority: "wont_do" }] },
    },
    include: {
      judgment: { select: { answers: true } },
      ticket: { include: { workspace: true } },
    },
    orderBy: { ticket: { createdAt: "desc" } },
  });

  const wontDo = NON_GOAL_DESCRIPTIONS.map(({ id, label, what }): WontDoGroup => {
    const tickets = declined.flatMap(({ judgment, ticket }) => {
      const { nonGoals } = storedAnswers.parse(judgment.answers);
      const [top] = Object.entries(nonGoals).toSorted((a, b) => b[1] - a[1]);
      if (top?.[0] !== id) return [];
      return [
        {
          id: ticket.id,
          subject: ticket.subject,
          workspace: ticket.workspace.name,
          workspaceId: ticket.workspace.id,
          plan: planOf(ticket.workspace.plan),
          arr: ticket.workspace.arr,
          probability: top[1],
          createdAt: ticket.createdAt.toISOString(),
        },
      ];
    });
    const workspaces = new Map(tickets.map((ticket) => [ticket.workspaceId, ticket.arr]));
    return {
      nonGoal: id,
      label,
      what,
      tickets: tickets.map(({ workspaceId: _workspaceId, ...ticket }) => ticket),
      workspaces: workspaces.size,
      arr: [...workspaces.values()].reduce((sum, arr) => sum + arr, 0),
    };
  });

  return {
    issues: demand
      .map((each): DemandIssue => {
        const issue = byId.get(each.issueId);
        return Object.assign(each, {
          title: issue?.title ?? "",
          tracker: issue?.tracker ?? "",
          source: issue?.source ?? "",
        });
      })
      .toSorted(
        (a, b) =>
          b.workspaces - a.workspaces || b.arr - a.arr || a.issueId.localeCompare(b.issueId),
      ),
    wontDo,
  };
}
