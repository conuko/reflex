// A reference baseline in plain code (ADR-0003): link a ticket to the top
// full-text search candidate when its rank clears a threshold, otherwise to
// none. The threshold is swept on dev (plan M3), and the result is compared
// with Jev's duplicate pick at the same false-match rate.

/** A duplicate candidate with its `ts_rank_cd` rank, normalized to 0..1 (normalization 32). */
export type RankedCandidate = { issueId: string; rank: number };

/** The top candidate's issue id when its rank is at least `threshold`, else null. */
export function ftsTop1(candidates: readonly RankedCandidate[], threshold: number): string | null {
  const [top] = candidates.toSorted((a, b) => b.rank - a.rank);
  return top !== undefined && top.rank >= threshold ? top.issueId : null;
}
