import type { Plan } from "@/lib/config/plans";
import type { Db } from "@/lib/db";

// Demand per existing issue (plan M4): how many tickets and workspaces are
// linked to it, their plans, their combined ARR with each workspace counted
// once, and a 14-day trend. A SQL aggregate, so it's exact and cheap; the
// policy uses it for feature requests, and the demand page (M5) shows it.

export const TREND_DAYS = 14;

export type IssueDemand = {
  issueId: string;
  tickets: number;
  workspaces: number;
  arr: number;
  plans: Record<Plan, number>;
  /** Linked tickets created per day over the last 14 days, oldest first. */
  trend: number[];
};

type DemandRow = {
  issueId: string;
  tickets: bigint;
  workspaces: bigint;
  arr: bigint | null;
  free: bigint;
  business: bigint;
  enterprise: bigint;
};
type TrendRow = { issueId: string; day: number; tickets: bigint };

/** Demand for the given issues, or for every linked issue when `issueIds` is omitted. */
export async function issueDemand(
  database: Db,
  { issueIds, now = new Date() }: { issueIds?: readonly string[]; now?: Date } = {},
): Promise<IssueDemand[]> {
  const all = issueIds === undefined;
  const ids = [...(issueIds ?? [])];
  const rows = await database.$queryRaw<DemandRow[]>`
    WITH links AS (
      SELECT l."issueId", t."id" AS "ticketId", t."workspaceId"
      FROM "TicketIssueLink" l
      JOIN "Ticket" t ON t."id" = l."ticketId"
      WHERE ${all} OR l."issueId" = ANY(${ids})
    ),
    workspaces AS (
      SELECT DISTINCT links."issueId", w."id", w."plan", w."arr"
      FROM links JOIN "Workspace" w ON w."id" = links."workspaceId"
    )
    SELECT w."issueId",
      (SELECT count(DISTINCT l."ticketId") FROM links l WHERE l."issueId" = w."issueId") AS tickets,
      count(*) AS workspaces,
      sum(w."arr") AS arr,
      count(*) FILTER (WHERE w."plan" = 'free') AS free,
      count(*) FILTER (WHERE w."plan" = 'business') AS business,
      count(*) FILTER (WHERE w."plan" = 'enterprise') AS enterprise
    FROM workspaces w
    GROUP BY w."issueId"
    ORDER BY w."issueId"
  `;
  const since = new Date(now.getTime() - TREND_DAYS * 86_400_000);
  const trend = await database.$queryRaw<TrendRow[]>`
    SELECT l."issueId",
      floor(extract(epoch FROM (t."createdAt" - ${since})) / 86400)::int AS day,
      count(DISTINCT t."id") AS tickets
    FROM "TicketIssueLink" l
    JOIN "Ticket" t ON t."id" = l."ticketId"
    WHERE (${all} OR l."issueId" = ANY(${ids})) AND t."createdAt" > ${since} AND t."createdAt" <= ${now}
    GROUP BY 1, 2
  `;

  return rows.map((row) => {
    const days = Array.from({ length: TREND_DAYS }, () => 0);
    for (const point of trend) {
      if (point.issueId === row.issueId && point.day >= 0 && point.day < TREND_DAYS) {
        days[point.day] = Number(point.tickets);
      }
    }
    return {
      issueId: row.issueId,
      tickets: Number(row.tickets),
      workspaces: Number(row.workspaces),
      arr: Number(row.arr ?? 0),
      plans: {
        free: Number(row.free),
        business: Number(row.business),
        enterprise: Number(row.enterprise),
      },
      trend: days,
    };
  });
}
