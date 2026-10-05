// `pnpm eval:run --part dev [--provider jev|fake] [--only type,area]`: asks a
// judgment provider about every item of one split part and prints accuracy and
// a confusion matrix per question. Results go to eval/results/<run>.jsonl, one
// line per item; rerunning the same command resumes a stopped run. M1 sends no
// duplicate candidates (no database yet), so the run's condition is
// `no-candidates`.

import { existsSync } from "node:fs";
import { join } from "node:path";

import type { ReportedQuestion } from "@/lib/eval/cli-args";
import type { RunHeader } from "@/lib/eval/runner";
import type { EvalItem } from "@/lib/eval/sets";
import type { Judgment, JudgmentProvider } from "@/lib/judgment/provider";

import { NON_GOALS } from "@/lib/config/non-goals";
import { scriptEnv } from "@/lib/env";
import { EVAL_USAGE, EvalArgsError, parseEvalArgs } from "@/lib/eval/cli-args";
import { accuracy, confusionMatrix } from "@/lib/eval/metrics";
import { readRun, recordTestRun, runEval } from "@/lib/eval/runner";
import { EVAL_SETS, loadEvalItems } from "@/lib/eval/sets";
import { readSplit, SPLIT_VERSION, splitPart } from "@/lib/eval/split";
import { createFakeProvider } from "@/lib/judgment/fake-provider";
import { createJevClient, createJevProvider } from "@/lib/judgment/jev-provider";
import { AREAS, QUESTION_SET_VERSION, questionSetHash, TICKET_TYPES } from "@/lib/triage/questions";

const RESULTS_DIR = join(import.meta.dirname, "results");
const CONDITION = "no-candidates";

let args;
try {
  args = parseEvalArgs(process.argv.slice(2));
} catch (error) {
  if (!(error instanceof EvalArgsError)) throw error;
  console.error(`${error.message}\n${EVAL_USAGE}`);
  process.exit(1);
}

const items = loadEvalItems();
const ids = new Set(splitPart(readSplit(), items, args.part));
const partItems = items.filter(({ id }) => ids.has(id));

const run = args.run ?? `${args.part}-${args.provider}-${QUESTION_SET_VERSION}-${CONDITION}`;
const file = join(RESULTS_DIR, `${run}.jsonl`);
const header: RunHeader = {
  kind: "run",
  part: args.part,
  provider: args.provider,
  condition: CONDITION,
  questionSetVersion: QUESTION_SET_VERSION,
  questionSetHash: questionSetHash(NON_GOALS),
  splitVersion: SPLIT_VERSION,
  startedAt: new Date().toISOString(),
};

if (args.part === "test" && !existsSync(file)) {
  console.log(
    `test run #${recordTestRun(RESULTS_DIR, { run, header })} (logged in eval/results/test-runs.jsonl)`,
  );
}

const controller = new AbortController();
process.once("SIGINT", () => {
  console.log("\nStopping after the requests in flight; rerun the same command to resume.");
  controller.abort();
});

console.log(`${run}: ${partItems.length} items, provider ${args.provider}, writing ${file}`);
let seen = 0;
const outcome = await runEval({
  file,
  header,
  items: partItems,
  provider: createProvider(args.provider),
  concurrency: args.concurrency,
  signal: controller.signal,
  onResult: ({ id, error }) => {
    seen++;
    if (error) console.error(`  ${id}: ${error}`);
    else if (seen % 10 === 0) console.log(`  ${seen} done`);
  },
});
console.log(
  `finished ${outcome.finished}, skipped ${outcome.skipped} already in the file, failed ${outcome.failed.length}`,
);
if (outcome.failed.length > 0) {
  console.error("Rerun the same command to retry the failed items.");
  process.exitCode = 1;
}

const results = readRun(file)?.items ?? [];
const judged = results.flatMap(({ id, judgment, ms }) => {
  const item = partItems.find((candidate) => candidate.id === id);
  return item ? [{ item, judgment, ms }] : [];
});
printTotals(judged);
for (const question of args.only) printQuestion(question, judged);

function createProvider(provider: "jev" | "fake"): JudgmentProvider {
  if (provider === "fake") return createFakeProvider();
  const { TYPESAFE_API_KEY } = scriptEnv("TYPESAFE_API_KEY");
  return createJevProvider({ client: createJevClient({ apiKey: TYPESAFE_API_KEY }) });
}

type Judged = { item: EvalItem; judgment: Judgment; ms: number };

function printTotals(rows: readonly Judged[]) {
  const tokens = rows.reduce((sum, { judgment }) => sum + judgment.usage.inputTokens, 0);
  const models = [...new Set(rows.map(({ judgment }) => judgment.model))].join(", ");
  const ms = rows.map(({ ms: each }) => each).toSorted((a, b) => a - b);
  const median = ms[Math.floor(ms.length / 2)] ?? 0;
  console.log(
    `\n${rows.length} judged by ${models || "nobody yet"}: ${tokens.toLocaleString("en-US")} input tokens, median ${median} ms`,
  );
}

function printQuestion(question: ReportedQuestion, rows: readonly Judged[]) {
  const labels: readonly string[] = question === "type" ? TICKET_TYPES : AREAS;
  const pairs = (subset: readonly Judged[]) =>
    subset.map(({ item, judgment }) => ({
      gold: item.gold[question],
      predicted: judgment.answers[question].choice,
    }));

  console.log(`\n${question}`);
  for (const set of [...EVAL_SETS, "all"] as const) {
    const subset = set === "all" ? rows : rows.filter(({ item }) => item.set === set);
    const { correct, n, value } = accuracy(pairs(subset));
    if (n > 0) console.log(`  ${set.padEnd(12)} ${correct}/${n} = ${value?.toFixed(2)}`);
  }

  const matrix = confusionMatrix(pairs(rows), labels);
  const width = Math.max(...labels.map((label) => label.length)) + 1;
  const short = labels.map((label) => label.slice(0, 6).padStart(7));
  console.log(`\n  ${"gold \\ answer".padEnd(width)}${short.join("")}`);
  for (const [row, label] of labels.entries()) {
    const cells = (matrix[row] ?? []).map((count) => String(count || ".").padStart(7));
    console.log(`  ${label.padEnd(width)}${cells.join("")}`);
  }
}
