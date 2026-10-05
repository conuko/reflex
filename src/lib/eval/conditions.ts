import { createHash } from "node:crypto";

import type { CorpusIssue } from "@/lib/issue-corpus";
import type { JudgmentInput } from "@/lib/judgment/provider";
import type { Candidate } from "@/lib/triage/questions";

import { toCandidate } from "@/lib/triage/candidates";
import { MAX_CANDIDATES } from "@/lib/triage/questions";

import type { CandidateSnapshot } from "./candidates-snapshot";
import type { EvalItem } from "./sets";

import { snapshotCandidates } from "./candidates-snapshot";

// The conditions an eval run asks Jev under (plan M3):
// - no-candidates: no duplicate question at all (the M1 first read)
// - candidates: the committed search snapshot, as the app would offer them
// - oracle: the same, but a duplicate's true original is always among them
// - shuffled: the same as candidates, with every choice's options in another order

export const CONDITIONS = ["no-candidates", "candidates", "oracle", "shuffled"] as const;
export type Condition = (typeof CONDITIONS)[number];

type Sources = { snapshot: CandidateSnapshot; issues: ReadonlyMap<string, CorpusIssue> };

export function judgmentInput(
  condition: Condition,
  sources: Sources,
): (item: EvalItem) => JudgmentInput {
  return (item) => {
    if (condition === "no-candidates") return { ticket: item.ticket, candidates: [] };
    const candidates = snapshotCandidates(sources.snapshot, item, sources.issues);
    if (condition === "oracle")
      return { ticket: item.ticket, candidates: withOriginal(item, candidates, sources) };
    if (condition === "shuffled")
      return { ticket: item.ticket, candidates, shuffleSeed: shuffleSeed(item.id) };
    return { ticket: item.ticket, candidates };
  };
}

/** How many items the oracle condition offers different candidates than the plain one. */
export function oracleChanges(items: readonly EvalItem[], sources: Sources): number {
  return items.filter((item) => {
    const candidates = snapshotCandidates(sources.snapshot, item, sources.issues);
    return withOriginal(item, candidates, sources) !== candidates;
  }).length;
}

/** A stable 32-bit seed per item, so the shuffled run is reproducible. */
export function shuffleSeed(id: string): number {
  return createHash("sha256").update(id).digest().readUInt32BE(0);
}

// The original replaces the lowest-ranked candidate when it's missing; the
// same array comes back when nothing changes.
function withOriginal(item: EvalItem, candidates: Candidate[], { issues }: Sources): Candidate[] {
  const original = item.gold.duplicateOf;
  if (original === null || candidates.some(({ issueId }) => issueId === original))
    return candidates;
  const issue = issues.get(original);
  if (!issue) throw new Error(`${item.id} duplicates a missing issue ${original}`);
  const candidate = toCandidate(
    { ...issue, closedAt: issue.closedAt === null ? null : new Date(issue.closedAt) },
    new Date(item.createdAt),
  );
  return [...candidates.slice(0, MAX_CANDIDATES - 1), candidate];
}
