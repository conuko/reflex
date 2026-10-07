import { z } from "zod";

import type { Db } from "@/lib/db";
import type { ItemBaselines } from "@/lib/eval/import";
import type { Report } from "@/lib/eval/report";
import type { Gold } from "@/lib/eval/sets";
import type { SplitPart } from "@/lib/eval/split";
import type { CalibrationBin } from "@/lib/eval/stats";
import type { Answers } from "@/lib/triage/parse-judgment";
import type { TicketState } from "@/lib/triage/state";

import { calibrationBins } from "@/lib/eval/stats";
import { storedAnswers } from "@/lib/triage/context";

// The evaluation screen (plan M5): the imported report of one part, its runs,
// and what the figures need beyond the report: the latency of each request,
// reliability bins from the same predictions as the report's ECE, and the
// items Jev got wrong. Every number shown comes from the committed results.

export type EvalRunSummary = {
  id: string;
  role: string;
  condition: string;
  model: string;
  questionSetVersion: string;
  questionSetHash: string;
  startedAt: string;
  itemCount: number;
};

export type Miss = {
  itemId: string;
  set: string;
  tracker: string;
  wrong: ("type" | "area" | "duplicate")[];
  gold: { type: string; area: string; duplicateOf: string | null };
  jev: { type: string; area: string; duplicate: string | null };
};

export type EvalOverview = {
  part: SplitPart;
  report: Report;
  importedAt: string;
  runs: EvalRunSummary[];
  /** Milliseconds per request of the sequential run (else the first run), ascending. */
  latency: { ms: number[]; sequential: boolean };
  /** Type and area answers of the first run, pooled, in 5 equal-mass bins (as the report's ECE). */
  reliability: CalibrationBin[];
  misses: Miss[];
};

export const RELIABILITY_BINS = 5;

/** The split's parts, test first; the same as SPLIT_PARTS, without reading the split file. */
export const EVAL_PARTS = ["test", "dev"] as const satisfies readonly SplitPart[];

const reportJson = z.custom<Report>((value) => typeof value === "object" && value !== null);
const goldJson = z.custom<Gold>((value) => typeof value === "object" && value !== null);
const baselinesJson = z.custom<ItemBaselines>(
  (value) => typeof value === "object" && value !== null,
);
const stateJson = z.custom<TicketState>((value) => typeof value === "object" && value !== null);

export async function evalParts(database: Db): Promise<SplitPart[]> {
  const reports = await database.evalReport.findMany({ select: { part: true } });
  return (["test", "dev"] as const).filter((part) =>
    reports.some((report) => report.part === part),
  );
}

export async function evalOverview(database: Db, part: SplitPart): Promise<EvalOverview | null> {
  const stored = await database.evalReport.findUnique({ where: { part } });
  if (!stored) return null;
  const runs = await database.evalRun.findMany({ where: { part }, orderBy: { id: "asc" } });
  const first = runs.find(({ role }) => role === "first");
  const second = runs.find(({ role }) => role === "second");
  const [firstItems, timed] = await Promise.all([
    first
      ? database.evalItem.findMany({ where: { runId: first.id }, orderBy: { itemId: "asc" } })
      : [],
    database.evalItem.findMany({
      where: { runId: (second ?? first)?.id ?? "" },
      select: { ms: true },
    }),
  ]);

  const judged = firstItems.map((row) => ({
    row,
    answers: storedAnswers.parse(row.answers),
    gold: goldJson.parse(row.gold),
  }));

  return {
    part,
    report: reportJson.parse(stored.report),
    importedAt: stored.importedAt.toISOString(),
    runs: runs.map((run) => ({
      id: run.id,
      role: run.role,
      condition: run.condition,
      model: run.model,
      questionSetVersion: run.questionSetVersion,
      questionSetHash: run.questionSetHash,
      startedAt: run.startedAt.toISOString(),
      itemCount: run.itemCount,
    })),
    latency: {
      ms: timed.map(({ ms }) => ms).toSorted((a, b) => a - b),
      sequential: second !== undefined,
    },
    reliability: calibrationBins(
      judged.flatMap(({ answers, gold }) =>
        (["type", "area"] as const).map((question) => ({
          probability: answers[question].probability,
          correct: answers[question].choice === gold[question],
        })),
      ),
      RELIABILITY_BINS,
    ),
    misses: judged.flatMap(({ row, answers, gold }): Miss[] => {
      const wrong = [
        ...(row.typeCorrect ? [] : (["type"] as const)),
        ...(row.areaCorrect ? [] : (["area"] as const)),
        ...(row.duplicateCorrect ? [] : (["duplicate"] as const)),
      ];
      return wrong.length === 0
        ? []
        : [
            {
              itemId: row.itemId,
              set: row.set,
              tracker: row.tracker,
              wrong,
              gold: { type: gold.type, area: gold.area, duplicateOf: gold.duplicateOf },
              jev: {
                type: answers.type.choice,
                area: answers.area.choice,
                duplicate: answers.duplicate?.issueId ?? null,
              },
            },
          ];
    }),
  };
}

export type EvalItemDetail = {
  itemId: string;
  part: SplitPart;
  set: string;
  tracker: string;
  gold: Gold;
  state: TicketState;
  baselines: ItemBaselines;
  runs: {
    runId: string;
    role: string;
    condition: string;
    ms: number;
    answers: Answers;
    candidates: { key: string; issueId: string; title: string; probability: number }[];
    correct: { type: boolean; area: boolean; duplicate: boolean };
  }[];
};

export async function evalItemDetail(
  database: Db,
  part: SplitPart,
  itemId: string,
): Promise<EvalItemDetail | null> {
  const rows = await database.evalItem.findMany({
    where: { itemId, run: { part } },
    include: { run: true },
    orderBy: { runId: "asc" },
  });
  const [first] = rows;
  if (!first) return null;
  const issueIds = rows.flatMap(({ candidateMap }) =>
    Object.values(z.record(z.string(), z.string()).parse(candidateMap)),
  );
  const titles = new Map(
    (
      await database.issue.findMany({
        where: { id: { in: [...new Set(issueIds)] } },
        select: { id: true, title: true },
      })
    ).map(({ id, title }) => [id, title]),
  );

  return {
    itemId,
    part,
    set: first.set,
    tracker: first.tracker,
    gold: goldJson.parse(first.gold),
    state: stateJson.parse(first.state),
    baselines: baselinesJson.parse(first.baselines),
    runs: rows.map((row) => {
      const answers = storedAnswers.parse(row.answers);
      const map = z.record(z.string(), z.string()).parse(row.candidateMap);
      return {
        runId: row.runId,
        role: row.run.role,
        condition: row.run.condition,
        ms: row.ms,
        answers,
        candidates: Object.entries(map)
          .map(([key, issueId]) => ({
            key,
            issueId,
            title: titles.get(issueId) ?? "",
            probability: answers.duplicate?.probabilities[key] ?? 0,
          }))
          .toSorted((a, b) => b.probability - a.probability),
        correct: { type: row.typeCorrect, area: row.areaCorrect, duplicate: row.duplicateCorrect },
      };
    }),
  };
}
