// `pnpm eval:report --part dev|test`: turns the committed Jev runs of one part
// into eval/results/summary-<part>.md and report-<part>.json (the app imports
// the JSON in M5). No model calls. It reads, for the current question set:
//   <part>-jev-<version>-candidates.jsonl    required
//   <part>-jev-<version>-shuffled.jsonl      optional
//   <part>-jev-<version>-candidates-2.jsonl  optional: the second, sequential run

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";

import type { Run } from "@/lib/eval/report";

import { KEYWORD_RULES_VERSION, loadKeywordRules } from "@/lib/eval/baselines/keyword-rules";
import { readCandidateSnapshot } from "@/lib/eval/candidates-snapshot";
import { buildReport } from "@/lib/eval/report";
import { renderReport } from "@/lib/eval/report-markdown";
import { readRun } from "@/lib/eval/runner";
import { loadEvalItems } from "@/lib/eval/sets";
import { groupItems, loadMirrors, readSplit, SPLIT_PARTS, splitPart } from "@/lib/eval/split";
import { QUESTION_SET_VERSION } from "@/lib/triage/questions";

const RESULTS_DIR = join(import.meta.dirname, "results");

const { values } = parseArgs({ options: { part: { type: "string" } }, strict: true });
const part = SPLIT_PARTS.find((candidate) => candidate === values.part);
if (!part) {
  console.error("Usage: pnpm eval:report --part dev|test");
  process.exit(1);
}

const items = loadEvalItems();
const split = readSplit();
const inPart = new Set(splitPart(split, items, part));
const dev = new Set(split.dev);

const load = (suffix: string): Run | undefined => {
  const run = readRun(join(RESULTS_DIR, `${part}-jev-${QUESTION_SET_VERSION}-${suffix}.jsonl`));
  return run ? { header: run.header, records: run.items } : undefined;
};
const candidates = load("candidates");
if (!candidates) {
  console.error(
    `No ${part} run with candidates for question set ${QUESTION_SET_VERSION}; run \`pnpm eval:run --part ${part}\` first.`,
  );
  process.exit(1);
}

const testRunsFile = join(RESULTS_DIR, "test-runs.jsonl");
const report = buildReport({
  items: items.filter(({ id }) => inPart.has(id)),
  devItems: items.filter(({ id }) => dev.has(id)),
  groups: groupItems(items, loadMirrors()),
  runs: { candidates, shuffled: load("shuffled"), second: load("candidates-2") },
  snapshot: readCandidateSnapshot(),
  keywordRules: { v0: loadKeywordRules("v0"), current: loadKeywordRules(KEYWORD_RULES_VERSION) },
  testRuns: existsSync(testRunsFile)
    ? readFileSync(testRunsFile, "utf8").split("\n").filter(Boolean).length
    : 0,
});

const summary = join(RESULTS_DIR, `summary-${part}.md`);
writeFileSync(summary, renderReport(report));
writeFileSync(join(RESULTS_DIR, `report-${part}.json`), `${JSON.stringify(report, null, 2)}\n`);
console.log(`wrote ${summary}\n`);
for (const { id, pass, value } of report.gate)
  console.log(`${pass ? "pass" : "FAIL"}  ${id.padEnd(20)} ${value}`);
