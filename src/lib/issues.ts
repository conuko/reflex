import type { Db } from "@/lib/db";
import type { CorpusIssue } from "@/lib/issue-corpus";

import { loadIssueCorpus } from "@/lib/issue-corpus";

// Loads the issue corpus (ADR-0002) into the "existing issues" table. Upserts
// by id, so importing again is safe and picks up a changed issue.

export async function importIssueCorpus(
  database: Db,
  issues: readonly CorpusIssue[] = loadIssueCorpus(),
): Promise<number> {
  await database.$transaction(
    issues.map((issue) => {
      const fields = {
        tracker: issue.tracker,
        number: issue.number,
        title: issue.title,
        body: issue.body,
        duplicateOf: issue.duplicateOf === null ? null : `${issue.tracker}#${issue.duplicateOf}`,
        createdAt: new Date(issue.createdAt),
        closedAt: issue.closedAt === null ? null : new Date(issue.closedAt),
      };
      return database.issue.upsert({
        where: { id: issue.id },
        create: { id: issue.id, ...fields },
        update: fields,
      });
    }),
  );
  return issues.length;
}
