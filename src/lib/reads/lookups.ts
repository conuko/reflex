import type { Plan } from "@/lib/config/plans";
import type { Db } from "@/lib/db";

import { planOf } from "./inbox";

// Small lookups for forms: issues to link a ticket to, and workspaces to send
// a Try-it ticket from.

export type IssueOption = { id: string; title: string; source: string };

/** Original issues of one tracker whose id or title contains the query, newest first. */
export async function searchIssues(
  database: Db,
  { tracker, query, limit = 8 }: { tracker: string; query: string; limit?: number },
): Promise<IssueOption[]> {
  const text = query.trim();
  return database.issue.findMany({
    where: {
      tracker,
      duplicateOf: null,
      ...(text && {
        OR: [
          { title: { contains: text, mode: "insensitive" } },
          { id: { contains: text, mode: "insensitive" } },
        ],
      }),
    },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: { id: true, title: true, source: true },
  });
}

export type WorkspaceOption = {
  id: string;
  name: string;
  plan: Plan;
  tracker: string;
  arr: number;
};

export async function listWorkspaces(database: Db): Promise<WorkspaceOption[]> {
  const workspaces = await database.workspace.findMany({ orderBy: { id: "asc" } });
  return workspaces.map(({ id, name, plan, tracker, arr }) => ({
    id,
    name,
    plan: planOf(plan),
    tracker,
    arr,
  }));
}
