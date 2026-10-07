import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { ImportOutcome } from "@/lib/eval/import";

import { importEvalResults, RESULTS_DIR } from "@/lib/eval/import";
import { expectedCalibrationError } from "@/lib/eval/stats";
import { importIssueCorpus } from "@/lib/issues";
import { evalItemDetail, evalOverview, evalParts, RELIABILITY_BINS } from "@/lib/reads/eval";
import { storedAnswers } from "@/lib/triage/context";

import { resetDatabase, testDb } from "../support/pipeline";

// `pnpm eval:import` (plan M5) on the committed results: the tables match the
// files, a second import changes nothing, and the evaluation screen's reads
// agree with the report the summary was written from.

const database = testDb();
let first: ImportOutcome;

/** Item lines per run file: every line but the header. */
function fileTotals() {
  const runs = readdirSync(RESULTS_DIR).filter(
    (file) => file.endsWith(".jsonl") && file !== "test-runs.jsonl",
  );
  return {
    runs: runs.length,
    items: runs.reduce(
      (sum, file) =>
        sum + readFileSync(join(RESULTS_DIR, file), "utf8").split("\n").filter(Boolean).length - 1,
      0,
    ),
  };
}

const report = (part: string): unknown =>
  JSON.parse(readFileSync(join(RESULTS_DIR, `report-${part}.json`), "utf8"));

beforeAll(async () => {
  await resetDatabase(database);
  await database.evalRun.deleteMany();
  await database.evalReport.deleteMany();
  await importIssueCorpus(database);
  first = await importEvalResults(database);
}, 120_000);

afterAll(async () => {
  await database.$disconnect();
});

describe("importEvalResults", () => {
  it("imports every run file and both reports, with totals matching the files", async () => {
    const totals = fileTotals();

    expect(first).toEqual({ reports: ["dev", "test"], ...totals });
    expect(await database.evalRun.count()).toBe(totals.runs);
    expect(await database.evalItem.count()).toBe(totals.items);
    const runs = await database.evalRun.findMany();
    const counts = await Promise.all(
      runs.map(({ id }) => database.evalItem.count({ where: { runId: id } })),
    );
    expect(counts).toEqual(runs.map(({ itemCount }) => itemCount));
    const reports = await database.evalReport.findMany({ orderBy: { part: "asc" } });
    expect(reports.map(({ report: stored }) => stored)).toEqual([report("dev"), report("test")]);
  });

  it("changes nothing when run again", async () => {
    const snapshot = async () =>
      (
        await database.evalItem.findMany({
          orderBy: [{ runId: "asc" }, { itemId: "asc" }],
          omit: { id: true },
        })
      ).map((row) => JSON.stringify(row));
    const before = await snapshot();

    const second = await importEvalResults(database);

    expect(second).toEqual(first);
    expect(await snapshot()).toEqual(before);
  }, 120_000);

  it("names each run's role as the report does", async () => {
    const roles = await database.evalRun.findMany({
      where: { part: "test" },
      select: { id: true, role: true },
      orderBy: { id: "asc" },
    });

    expect(roles).toEqual([
      { id: "test-jev-v1-candidates", role: "first" },
      { id: "test-jev-v1-candidates-2", role: "second" },
      { id: "test-jev-v1-shuffled", role: "shuffled" },
    ]);
  });
});

describe("the evaluation screen's reads", () => {
  it("reproduces the report's ECE from the imported items, and the latency count", async () => {
    const overview = await evalOverview(database, "test");
    if (!overview) throw new Error("no test report");

    const n = overview.reliability.reduce((sum, bin) => sum + bin.n, 0);
    const ece = overview.reliability.reduce(
      (sum, bin) => sum + (bin.n / n) * Math.abs(bin.accuracy - bin.confidence),
      0,
    );

    expect(overview.reliability).toHaveLength(RELIABILITY_BINS);
    expect(n).toBe(overview.report.calibration.choice.n);
    expect(ece).toBeCloseTo(overview.report.calibration.choice.ece ?? Number.NaN, 12);
    expect(overview.latency).toMatchObject({ sequential: true });
    expect(overview.latency.ms).toHaveLength(overview.report.latency.n);
    expect(await evalParts(database)).toEqual(["test", "dev"]);
  });

  it("lists exactly the first run's items with a wrong type, area or duplicate", async () => {
    const overview = await evalOverview(database, "test");
    const wrong = await database.evalItem.count({
      where: {
        runId: "test-jev-v1-candidates",
        OR: [{ typeCorrect: false }, { areaCorrect: false }, { duplicateCorrect: false }],
      },
    });
    const { type } = overview?.report ?? {};

    expect(overview?.misses).toHaveLength(wrong);
    expect(overview?.misses.filter(({ wrong: fields }) => fields.includes("type"))).toHaveLength(
      (type?.jev.n ?? 0) - (type?.jev.k ?? 0),
    );
  });

  it("opens one item with every run, the baselines and the gold label", async () => {
    const { itemId, tracker } = await database.evalItem.findFirstOrThrow({
      where: { runId: "test-jev-v1-candidates", set: "corpus" },
      orderBy: { itemId: "asc" },
    });

    const detail = await evalItemDetail(database, "test", itemId);

    expect(detail).toMatchObject({ itemId, set: "corpus", tracker, part: "test" });
    expect(detail?.runs.map(({ role }) => role).toSorted()).toEqual([
      "first",
      "second",
      "shuffled",
    ]);
    expect(detail?.baselines.keyword.type).toEqual(expect.any(String));
    expect(detail?.gold.type).toEqual(expect.any(String));
    expect(await evalItemDetail(database, "test", "nope")).toBeNull();
  });

  it("matches the ECE function the report used", async () => {
    const items = await database.evalItem.findMany({ where: { runId: "test-jev-v1-candidates" } });
    const overview = await evalOverview(database, "test");
    const predictions = items.flatMap((row) => {
      const answers = storedAnswers.parse(row.answers);
      return [
        { probability: answers.type.probability, correct: row.typeCorrect },
        { probability: answers.area.probability, correct: row.areaCorrect },
      ];
    });

    expect(expectedCalibrationError(predictions)).toBeCloseTo(
      overview?.report.calibration.choice.ece ?? Number.NaN,
      12,
    );
  });
});
