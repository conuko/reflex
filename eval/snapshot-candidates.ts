// `pnpm eval:candidates`: imports the issue corpus into Postgres, searches
// every eval item's duplicate candidates as of the item's creation time, and
// writes eval/candidates/v1.json. No model calls. Rerunning gives the same file.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { db } from "@/lib/db";
import {
  buildCandidateSnapshot,
  CANDIDATES_FILE,
  serializeCandidateSnapshot,
} from "@/lib/eval/candidates-snapshot";
import { loadEvalItems } from "@/lib/eval/sets";
import { importIssueCorpus } from "@/lib/issues";

const database = db();
try {
  console.log(`imported ${await importIssueCorpus(database)} issues`);
  const items = loadEvalItems();
  const snapshot = await buildCandidateSnapshot(database, items);
  mkdirSync(dirname(CANDIDATES_FILE), { recursive: true });
  writeFileSync(CANDIDATES_FILE, serializeCandidateSnapshot(snapshot));

  const counts = Object.values(snapshot.items).map((ranked) => ranked.length);
  const empty = counts.filter((count) => count === 0).length;
  console.log(
    `wrote ${CANDIDATES_FILE}: ${counts.length} items, ${counts.reduce((a, b) => a + b, 0)} candidates, ${empty} items without any`,
  );
} finally {
  await database.$disconnect();
}
