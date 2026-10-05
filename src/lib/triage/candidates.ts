import type { Db } from "@/lib/db";

import type { Candidate } from "./questions";
import type { TicketInput } from "./state";

import { normalizeBody } from "./normalize";
import { MAX_CANDIDATES } from "./questions";

// Duplicate candidates for a ticket from Postgres full-text search. They
// become the options of the `duplicate_of` question, so this search caps how
// well any duplicate pick can do (recall is measured on its own in M2).
//
// The query ORs together the ticket's most distinctive terms: those that the
// fewest eligible issues contain. Eligible issues are canonical (not
// themselves duplicates), in the ticket's tracker and created before the
// ticket, and never the ticket itself. Results are ranked with `ts_rank_cd`,
// normalized to 0..1. Ticket text only ever travels as a query parameter.

/** How many distinctive terms the search ORs together. */
export const SEARCH_TERMS = 20;

export type RankedCandidate = Candidate & { rank: number };

export type CandidateQuery = {
  tracker: string;
  ticket: TicketInput;
  /** Only issues created before this count, and their state is taken as of then. */
  before: Date;
  /** The ticket's own issue, when the ticket is an issue re-sent as a ticket. */
  excludeIssueId?: string | null;
  limit?: number;
};

type Row = { id: string; title: string; body: string; closedAt: Date | null; rank: number };

export async function findCandidates(
  database: Db,
  { tracker, ticket, before, excludeIssueId = null, limit = MAX_CANDIDATES }: CandidateQuery,
): Promise<RankedCandidate[]> {
  const text = [ticket.subject, ...ticket.messages.map((message) => message.text)].join("\n");
  const exclude = excludeIssueId ?? "";

  const rows = await database.$queryRaw<Row[]>`
    WITH eligible AS (
      SELECT i."id", i."title", i."body", i."closedAt", i."createdAt", i."searchVector"
      FROM "Issue" i
      WHERE i."tracker" = ${tracker}
        AND i."duplicateOf" IS NULL
        AND i."createdAt" < ${before}
        AND i."id" <> ${exclude}
        AND i."searchVector" IS NOT NULL
    ),
    term_docs AS (
      SELECT u.lexeme, count(*) AS docs
      FROM eligible e, unnest(e."searchVector") AS u
      GROUP BY u.lexeme
    ),
    terms AS (
      SELECT DISTINCT t.lexeme, d.docs
      FROM unnest(to_tsvector('english', ${text})) AS t
      JOIN term_docs d ON d.lexeme = t.lexeme
      WHERE t.lexeme ~ '^[a-z0-9_]+$'
      ORDER BY d.docs ASC, t.lexeme ASC
      LIMIT ${SEARCH_TERMS}
    ),
    query AS (
      SELECT to_tsquery('simple', string_agg(lexeme, ' | ')) AS q FROM terms
    )
    SELECT e."id", e."title", e."body", e."closedAt",
      ts_rank_cd(e."searchVector", query.q, 32)::float8 AS rank
    FROM eligible e, query
    WHERE query.q IS NOT NULL AND e."searchVector" @@ query.q
    ORDER BY rank DESC, e."createdAt" DESC, e."id" ASC
    LIMIT ${limit}
  `;

  return rows.map((row) => Object.assign(toCandidate(row, before), { rank: row.rank }));
}

/** An existing issue as an option of the duplicate question, as it stood at `asOf`. */
export function toCandidate(
  issue: { id: string; title: string; body: string; closedAt: Date | null },
  asOf: Date,
): Candidate {
  return {
    issueId: issue.id,
    title: issue.title,
    excerpt: normalizeBody(issue.body).replace(/\s+/g, " "),
    state: issue.closedAt !== null && issue.closedAt <= asOf ? "closed" : "open",
  };
}
