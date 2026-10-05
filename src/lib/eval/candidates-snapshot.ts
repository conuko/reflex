import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

import type { Db } from "@/lib/db";
import type { CorpusIssue } from "@/lib/issue-corpus";
import type { Candidate } from "@/lib/triage/questions";

import { findCandidates, SEARCH_TERMS, toCandidate } from "@/lib/triage/candidates";

import type { EvalItem } from "./sets";

// Every eval item's duplicate candidates, searched once in Postgres and
// committed (plan M2), so eval runs and the seed need no database and always
// offer the same options. Each item is searched as of its own creation time.
// A change to the search query needs a new CANDIDATES_VERSION.

export const CANDIDATES_VERSION = "v1";
export const CANDIDATES_FILE = join(
  import.meta.dirname,
  `../../../eval/candidates/${CANDIDATES_VERSION}.json`,
);

const snapshotSchema = z
  .object({
    version: z.string(),
    searchTerms: z.int(),
    items: z.record(z.string(), z.array(z.object({ issueId: z.string(), rank: z.number() }))),
  })
  .strict();

export type CandidateSnapshot = z.infer<typeof snapshotSchema>;

export async function buildCandidateSnapshot(
  database: Db,
  items: readonly EvalItem[],
): Promise<CandidateSnapshot> {
  const found = await Promise.all(
    items.map(async (item) => {
      const candidates = await findCandidates(database, {
        tracker: item.tracker,
        ticket: item.ticket,
        before: new Date(item.createdAt),
        excludeIssueId: item.set === "corpus" ? item.id : null,
      });
      // Rounded, so the committed file doesn't change with float noise.
      const ranked = candidates.map(({ issueId, rank }) => ({
        issueId,
        rank: Number(rank.toFixed(6)),
      }));
      return [item.id, ranked] as const;
    }),
  );
  return {
    version: CANDIDATES_VERSION,
    searchTerms: SEARCH_TERMS,
    items: Object.fromEntries(found.toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))),
  };
}

export function serializeCandidateSnapshot(snapshot: CandidateSnapshot): string {
  return `${JSON.stringify(snapshot, null, 2)}\n`;
}

export function readCandidateSnapshot(path: string = CANDIDATES_FILE): CandidateSnapshot {
  return snapshotSchema.parse(JSON.parse(readFileSync(path, "utf8")));
}

/** An item's candidates from the snapshot, as options of the duplicate question. */
export function snapshotCandidates(
  snapshot: CandidateSnapshot,
  item: EvalItem,
  issues: ReadonlyMap<string, CorpusIssue>,
): Candidate[] {
  const ranked = snapshot.items[item.id];
  if (!ranked)
    throw new Error(`${item.id} has no candidates in the snapshot; run \`pnpm eval:candidates\``);
  return ranked.map(({ issueId }) => {
    const issue = issues.get(issueId);
    if (!issue) throw new Error(`The snapshot names a missing issue ${issueId}`);
    return toCandidate(
      { ...issue, closedAt: issue.closedAt === null ? null : new Date(issue.closedAt) },
      new Date(item.createdAt),
    );
  });
}
