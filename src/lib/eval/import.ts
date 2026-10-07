import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

import type { Db } from "@/lib/db";

import { AREAS, TICKET_TYPES } from "@/lib/triage/questions";
import { buildState } from "@/lib/triage/state";

import type { KeywordAnswers, KeywordRules } from "./baselines/keyword-rules";
import type { CandidateSnapshot } from "./candidates-snapshot";
import type { Report } from "./report";
import type { ItemRecord, RunHeader } from "./runner";
import type { EvalItem } from "./sets";
import type { Split, SplitPart } from "./split";

import { ftsTop1 } from "./baselines/fts-top1";
import {
  KEYWORD_RULES_VERSION,
  loadKeywordRules,
  predictWithKeywords,
} from "./baselines/keyword-rules";
import { majorityLabel } from "./baselines/majority";
import { readCandidateSnapshot } from "./candidates-snapshot";
import { readRun } from "./runner";
import { loadEvalItems } from "./sets";
import { readSplit, SPLIT_PARTS } from "./split";

// `pnpm eval:import` (plan M5): loads the committed eval results into the
// EvalReport, EvalRun and EvalItem tables, so the app shows real numbers
// without asking a model anything. Every run file in eval/results/ becomes a
// run; each of its items is stored with its gold labels and the reference
// baselines' answers for the same state (ADR-0003). Importing replaces what
// was there, so a second import changes nothing.

export const RESULTS_DIR = join(import.meta.dirname, "../../../eval/results");

/** Not a run: the log of test runs (see `recordTestRun`). */
const NOT_RUNS = new Set(["test-runs.jsonl"]);

export type ItemBaselines = {
  /** The dev majority class, the same for every item. */
  majority: { type: string; area: string };
  keywordV0: KeywordAnswers;
  keyword: KeywordAnswers;
  /** The search's top candidate at the threshold the report chose for this part, or none. */
  ftsTop1: string | null;
  ftsThreshold: number | null;
};

export type ImportOutcome = { reports: SplitPart[]; runs: number; items: number };

// Written by `pnpm eval:report`, so only the shape this module reads is checked.
const reportFile = z.custom<Report>(
  (value) =>
    typeof value === "object" &&
    value !== null &&
    "part" in value &&
    "gate" in value &&
    "duplicates" in value,
  "not an eval report",
);

export async function importEvalResults(
  database: Db,
  {
    resultsDir = RESULTS_DIR,
    items = loadEvalItems(),
    split = readSplit(),
    snapshot = readCandidateSnapshot(),
    keywordRules = { v0: loadKeywordRules("v0"), current: loadKeywordRules(KEYWORD_RULES_VERSION) },
  }: {
    resultsDir?: string;
    items?: readonly EvalItem[];
    split?: Split;
    snapshot?: CandidateSnapshot;
    keywordRules?: { v0: KeywordRules; current: KeywordRules };
  } = {},
): Promise<ImportOutcome> {
  const reports = new Map<SplitPart, Report>();
  for (const part of SPLIT_PARTS) {
    const file = join(resultsDir, `report-${part}.json`);
    if (existsSync(file))
      reports.set(part, reportFile.parse(JSON.parse(readFileSync(file, "utf8"))));
  }

  const byId = new Map(items.map((item) => [item.id, item]));
  const dev = new Set(split.dev);
  const devItems = items.filter(({ id }) => dev.has(id));
  const fallback = {
    type: majorityLabel(
      devItems.map(({ gold }) => gold.type),
      TICKET_TYPES,
    ),
    area: majorityLabel(
      devItems.map(({ gold }) => gold.area),
      AREAS,
    ),
  };

  const files = readdirSync(resultsDir)
    .filter((file) => file.endsWith(".jsonl") && !NOT_RUNS.has(file))
    .toSorted();
  const runs = files.flatMap((file) => {
    const run = readRun(join(resultsDir, file));
    return run ? [{ id: file.replace(/\.jsonl$/, ""), ...run }] : [];
  });

  await database.$transaction(
    async (tx) => {
      for (const [part, report] of reports) {
        // oxlint-disable-next-line eslint/no-await-in-loop
        await tx.evalReport.upsert({
          where: { part },
          create: { part, report },
          update: { report, importedAt: new Date() },
        });
      }
      await tx.evalReport.deleteMany({ where: { part: { notIn: [...reports.keys()] } } });
      // Runs whose file is gone go too, so the tables always match the files.
      await tx.evalRun.deleteMany({});
      for (const run of runs) {
        const threshold = reports.get(run.header.part)?.duplicates.search.threshold ?? null;
        // oxlint-disable-next-line eslint/no-await-in-loop
        await tx.evalRun.create({
          data: {
            id: run.id,
            part: run.header.part,
            role: runRole(run.id, run.header),
            condition: run.header.condition,
            provider: run.header.provider,
            model: [...new Set(run.items.map(({ judgment }) => judgment.model))].join(", "),
            questionSetVersion: run.header.questionSetVersion,
            questionSetHash: run.header.questionSetHash,
            splitVersion: run.header.splitVersion,
            startedAt: new Date(run.header.startedAt),
            itemCount: run.items.length,
          },
        });
        // oxlint-disable-next-line eslint/no-await-in-loop
        await tx.evalItem.createMany({
          data: run.items.map((record) => {
            const item = byId.get(record.id);
            if (!item) throw new Error(`${run.id} has an unknown item ${record.id}`);
            return itemRow(run.id, item, record, {
              baselines: baselinesFor(item, { keywordRules, fallback, snapshot, threshold }),
            });
          }),
        });
      }
    },
    { timeout: 120_000 },
  );

  return {
    reports: [...reports.keys()],
    runs: runs.length,
    items: runs.reduce((sum, run) => sum + run.items.length, 0),
  };
}

/** first, second (the sequential repeat), shuffled, or the condition for other runs. */
export function runRole(id: string, header: RunHeader): string {
  if (header.condition === "candidates") return id.endsWith("-2") ? "second" : "first";
  return header.condition;
}

export function baselinesFor(
  item: EvalItem,
  {
    keywordRules,
    fallback,
    snapshot,
    threshold,
  }: {
    keywordRules: { v0: KeywordRules; current: KeywordRules };
    fallback: { type: (typeof TICKET_TYPES)[number]; area: (typeof AREAS)[number] };
    snapshot: CandidateSnapshot;
    threshold: number | null;
  },
): ItemBaselines {
  const state = buildState(item.ticket);
  return {
    majority: fallback,
    keywordV0: predictWithKeywords(state, keywordRules.v0, fallback),
    keyword: predictWithKeywords(state, keywordRules.current, fallback),
    ftsTop1: threshold === null ? null : ftsTop1(snapshot.items[item.id] ?? [], threshold),
    ftsThreshold: threshold,
  };
}

function itemRow(
  runId: string,
  item: EvalItem,
  record: ItemRecord,
  { baselines }: { baselines: ItemBaselines },
) {
  const { judgment } = record;
  const { answers } = judgment;
  return {
    runId,
    itemId: item.id,
    set: item.set,
    tracker: item.tracker,
    gold: item.gold,
    state: judgment.state,
    candidateMap: judgment.candidateMap,
    answers,
    baselines,
    ms: Math.round(record.ms),
    inputTokens: judgment.usage.inputTokens,
    outputTokens: judgment.usage.outputTokens,
    typeCorrect: answers.type.choice === item.gold.type,
    areaCorrect: answers.area.choice === item.gold.area,
    duplicateCorrect: (answers.duplicate?.issueId ?? null) === item.gold.duplicateOf,
  };
}
