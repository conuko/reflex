import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

import { AREAS, TICKET_TYPES } from "@/lib/triage/questions";

// The issue corpus (ADR-0002): hand-written existing issues of two fictional
// trackers, one JSON file each under data/issues/. Every issue carries its
// gold labels, and a duplicate names the older issue it duplicates.

export const TRACKERS = ["librechat", "lobehub"] as const;
export const PRIORITIES = ["high", "medium", "low"] as const;

export type Tracker = (typeof TRACKERS)[number];
export type Priority = (typeof PRIORITIES)[number];

const CORPUS_DIR = join(import.meta.dirname, "../../data/issues");

const corpusIssue = z.object({
  number: z.number().int().positive(),
  title: z.string().min(1),
  body: z.string().min(1),
  createdAt: z.iso.datetime(),
  closedAt: z.iso.datetime().nullable(),
  type: z.enum(TICKET_TYPES),
  area: z.enum(AREAS),
  priority: z.enum(PRIORITIES),
  /** The number of the older issue in the same tracker that this one duplicates. */
  duplicateOf: z.number().int().positive().nullable(),
});

const corpusFile = z.object({ tracker: z.enum(TRACKERS), issues: z.array(corpusIssue) });

export type CorpusIssue = z.infer<typeof corpusIssue> & {
  /** `<tracker>#<number>`, e.g. `librechat#2101`. */
  id: string;
  tracker: Tracker;
};

export function loadIssueCorpus(dir: string = CORPUS_DIR): CorpusIssue[] {
  return readdirSync(dir)
    .filter((file) => file.endsWith(".json"))
    .toSorted()
    .flatMap((file) => {
      const { tracker, issues } = corpusFile.parse(
        JSON.parse(readFileSync(join(dir, file), "utf8")),
      );
      const withIds = issues.map((issue) =>
        Object.assign(issue, { id: `${tracker}#${issue.number}`, tracker }),
      );
      checkConsistency(withIds);
      return withIds;
    });
}

function checkConsistency(issues: readonly CorpusIssue[]) {
  const byNumber = new Map<number, CorpusIssue>();
  for (const issue of issues) {
    if (byNumber.has(issue.number)) throw new Error(`${issue.id} appears more than once`);
    byNumber.set(issue.number, issue);
  }

  for (const issue of issues) {
    if (issue.closedAt !== null && issue.closedAt < issue.createdAt) {
      throw new Error(`${issue.id} was closed before it was created`);
    }
    if (issue.duplicateOf === null) continue;

    const original = byNumber.get(issue.duplicateOf);
    if (!original) throw new Error(`${issue.id} duplicates a missing issue`);
    if (original.createdAt >= issue.createdAt)
      throw new Error(`${issue.id} duplicates a newer issue`);
    if (original.duplicateOf !== null) throw new Error(`${issue.id} duplicates another duplicate`);
    if (issue.closedAt === null) throw new Error(`${issue.id} is a duplicate but still open`);
  }
}
