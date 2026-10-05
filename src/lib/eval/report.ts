import type { Priority } from "@/lib/issue-corpus";
import type { TriageContext } from "@/lib/policy";
import type { Answers } from "@/lib/triage/parse-judgment";

import { PRIORITIES } from "@/lib/issue-corpus";
import { triage } from "@/lib/policy";
import { DEFAULT_POLICY } from "@/lib/policy-schema";
import { jevCostUsd } from "@/lib/pricing";
import { goldLevel } from "@/lib/priorities";
import { AREAS, REACHES, TICKET_TYPES } from "@/lib/triage/questions";
import { buildState } from "@/lib/triage/state";

import type { KeywordAnswers, KeywordRules } from "./baselines/keyword-rules";
import type { CandidateSnapshot } from "./candidates-snapshot";
import type { GateCheckId } from "./gate";
import type { ItemRecord, RunHeader } from "./runner";
import type { EvalItem, EvalSet, Gold } from "./sets";
import type { Interval } from "./stats";

import { ftsTop1 } from "./baselines/fts-top1";
import { predictWithKeywords } from "./baselines/keyword-rules";
import { majorityLabel } from "./baselines/majority";
import { GATE_THRESHOLDS } from "./gate";
import { confusionMatrix, recallAtK } from "./metrics";
import { EVAL_SETS } from "./sets";
import {
  bootstrapInterval,
  brierScore,
  cohenKappa,
  expectedCalibrationError,
  linearWeightedKappa,
  mcnemarExact,
  quantile,
  wilson,
} from "./stats";

// The eval report (plan M3): every metric of "Evaluation method", computed
// from committed results only, with Jev's numbers next to the plain-code
// reference baselines (ADR-0003). Pure arithmetic: eval/report.ts reads the
// files and writes the summary.

/** The facts the policy gets in the eval: a Business workspace, no spike, no demand. */
export const EVAL_CONTEXT: TriageContext = {
  plan: "business",
  spikeActive: false,
  demand: { workspaces: 0, arr: 0 },
};

/** Below this n, a rate's interval is Wilson's; from it on, a group bootstrap, unless every
 * outcome is the same: a bootstrap can't vary then and would claim an interval of zero width. */
const BOOTSTRAP_MIN_N = 40;
const REVIEW_THRESHOLDS = [0.5, 0.6, 0.7, 0.8, 0.9] as const;
const YES = 0.5;
const SIGNALS = [
  "blocked",
  "workaround",
  "regression",
  "dataExposure",
  "dataLoss",
  "injection",
] as const;

export type Rate = { k: number; n: number; value: number | null; ci: Interval | null };

export type Run = { header: RunHeader; records: ItemRecord[] };

export type ReportInput = {
  items: readonly EvalItem[];
  /** Dev items, which the majority baseline is fitted on. */
  devItems: readonly EvalItem[];
  /** Items that belong together (see `groupItems` in split.ts), resampled whole by the bootstrap. */
  groups: readonly (readonly string[])[];
  runs: { candidates: Run; shuffled?: Run; second?: Run };
  snapshot: CandidateSnapshot;
  keywordRules: { v0: KeywordRules; current: KeywordRules };
  testRuns: number | null;
};

export type ChoiceSection = {
  jev: Rate;
  bySet: Partial<Record<EvalSet, Rate>>;
  majority: Rate & { label: string };
  keywordV0: Rate;
  keyword: Rate & { coverage: Rate };
  /** Exact McNemar against the current keyword rules: items only Jev got right, and only the rules. */
  mcnemar: { jevOnly: number; keywordOnly: number; p: number };
  /** Jev's accuracy minus the keyword rules', with a paired group-bootstrap interval. */
  difference: { value: number | null; ci: Interval | null };
  confusion: { labels: readonly string[]; matrix: number[][] };
};

export type Report = {
  part: string;
  runs: {
    condition: string;
    model: string;
    questionSetVersion: string;
    questionSetHash: string;
    items: number;
  }[];
  splitVersion: string;
  candidatesVersion: string;
  keywordRulesVersion: string;
  testRuns: number | null;
  counts: Partial<Record<EvalSet, number>>;
  type: ChoiceSection;
  area: ChoiceSection;
  priority: {
    exact: Rate;
    withinOne: Rate;
    weightedKappa: number | null;
    /** Gold rows, policy columns, both high, medium, low. */
    matrix: number[][];
    bugsExact: Rate;
    majorityExact: Rate & { label: Priority };
    /** The policy over the hand-written sets' gold answers: what perfect answers would score. */
    goldAnswersExact: Rate;
  };
  duplicates: {
    positives: number;
    recall: { k: number; rate: Rate }[];
    pickAccuracy: Rate;
    hitRate: Rate;
    falseMatchRate: Rate;
    shuffleStability: Rate | null;
    /** The search's top hit above the threshold that keeps its false-match rate at or below Jev's. */
    search: { threshold: number | null; hitRate: Rate; falseMatchRate: Rate };
  };
  injection: {
    recall: Rate;
    falsePositiveRate: Rate;
    /** Injections whose triage ended where the attacker wanted. */
    attackSuccess: Rate;
    keyword: { recall: Rate; falsePositiveRate: Rate };
  };
  nonGoals: {
    correct: Rate;
    falsePositives: Rate;
    keyword: { correct: Rate; falsePositives: Rate };
  };
  consistency: {
    secondRun: {
      type: Rate;
      area: Rate;
      duplicate: Rate;
      typeKappa: number | null;
      areaKappa: number | null;
    } | null;
    shuffleFlips: { type: Rate; area: Rate } | null;
  };
  calibration: {
    choice: { n: number; ece: number | null; brier: number | null };
    signals: { name: string; accuracy: Rate; brier: number | null }[];
    reviewCurve: { threshold: number; sentToReview: Rate; accuracyOfRest: Rate }[];
  };
  latency: { n: number; p50: number; p95: number; sequential: boolean };
  cost: { meanInputTokens: number; usdPer1000Tickets: number };
  gate: { id: GateCheckId; pass: boolean; value: string }[];
};

type Judged = { item: EvalItem; answers: Answers; candidateIds: string[] };
type Outcome = { id: string; ok: boolean };
type RateOf = (outcomes: readonly Outcome[]) => Rate;

export function buildReport(input: ReportInput): Report {
  const { items, devItems, runs, snapshot } = input;
  const groupOf = new Map(
    input.groups.flatMap((ids, index) => ids.map((id) => [id, index] as const)),
  );
  const rate: RateOf = (outcomes) => rateOf(outcomes, groupOf);

  const judged = join(items, runs.candidates);
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
  const keywordAnswers = (rules: KeywordRules) =>
    new Map(
      judged.map(({ item }) => [
        item.id,
        predictWithKeywords(buildState(item.ticket), rules, fallback),
      ]),
    );
  const keyword = keywordAnswers(input.keywordRules.current);

  const body: Omit<Report, "gate"> = {
    part: runs.candidates.header.part,
    runs: [runs.candidates, runs.shuffled, runs.second].flatMap((run) =>
      run
        ? [
            {
              condition: run.header.condition,
              model: [...new Set(run.records.map(({ judgment }) => judgment.model))].join(", "),
              questionSetVersion: run.header.questionSetVersion,
              questionSetHash: run.header.questionSetHash,
              items: run.records.length,
            },
          ]
        : [],
    ),
    splitVersion: runs.candidates.header.splitVersion,
    candidatesVersion: snapshot.version,
    keywordRulesVersion: input.keywordRules.current.version,
    testRuns: input.testRuns,
    counts: Object.fromEntries(
      EVAL_SETS.map((set) => [set, items.filter((item) => item.set === set).length]),
    ),
    type: choiceSection("type", TICKET_TYPES, fallback.type, judged, {
      v0: keywordAnswers(input.keywordRules.v0),
      current: keyword,
      groupOf,
      rate,
    }),
    area: choiceSection("area", AREAS, fallback.area, judged, {
      v0: keywordAnswers(input.keywordRules.v0),
      current: keyword,
      groupOf,
      rate,
    }),
    priority: prioritySection(judged, devItems, rate),
    duplicates: duplicateSection(
      judged,
      snapshot,
      runs.shuffled ? join(items, runs.shuffled) : null,
      rate,
    ),
    injection: injectionSection(judged, keyword, rate),
    nonGoals: nonGoalSection(judged, keyword, rate),
    consistency: {
      secondRun: runs.second ? secondRunSection(judged, join(items, runs.second), rate) : null,
      shuffleFlips: runs.shuffled
        ? shuffleFlipSection(judged, join(items, runs.shuffled), rate)
        : null,
    },
    calibration: calibrationSection(judged, rate),
    latency: latencySection(runs.second ?? runs.candidates, runs.second !== undefined),
    cost: costSection(runs.candidates),
  };
  return { ...body, gate: evaluateGate(body) };
}

function choiceSection(
  question: "type" | "area",
  labels: readonly string[],
  majority: string,
  judged: readonly Judged[],
  keyword: {
    v0: ReadonlyMap<string, KeywordAnswers>;
    current: ReadonlyMap<string, KeywordAnswers>;
    groupOf: ReadonlyMap<string, number>;
    rate: RateOf;
  },
): ChoiceSection {
  const { rate } = keyword;
  const jevRight = ({ item, answers }: Judged) => answers[question].choice === item.gold[question];
  const ruleRight = ({ item }: Judged, rules: ReadonlyMap<string, KeywordAnswers>) =>
    rules.get(item.id)?.[question] === item.gold[question];
  const outcomes = (right: (entry: Judged) => boolean, subset = judged) =>
    subset.map((entry) => ({ id: entry.item.id, ok: right(entry) }));

  const jevOnly = judged.filter(
    (entry) => jevRight(entry) && !ruleRight(entry, keyword.current),
  ).length;
  const keywordOnly = judged.filter(
    (entry) => !jevRight(entry) && ruleRight(entry, keyword.current),
  ).length;
  const paired = judged.map((entry) => ({
    id: entry.item.id,
    diff: Number(jevRight(entry)) - Number(ruleRight(entry, keyword.current)),
  }));

  return {
    jev: rate(outcomes(jevRight)),
    bySet: Object.fromEntries(
      EVAL_SETS.flatMap((set) => {
        const subset = judged.filter(({ item }) => item.set === set);
        return subset.length === 0 ? [] : [[set, rate(outcomes(jevRight, subset))]];
      }),
    ),
    majority: {
      ...rate(outcomes(({ item }) => item.gold[question] === majority)),
      label: majority,
    },
    keywordV0: rate(outcomes((entry) => ruleRight(entry, keyword.v0))),
    keyword: {
      ...rate(outcomes((entry) => ruleRight(entry, keyword.current))),
      coverage: rate(
        outcomes(({ item }) => keyword.current.get(item.id)?.matched[question] === true),
      ),
    },
    mcnemar: { jevOnly, keywordOnly, p: mcnemarExact(jevOnly, keywordOnly) },
    difference: {
      value: mean(paired.map(({ diff }) => diff)),
      ci: bootstrapInterval(groupsOf(paired, keyword.groupOf), (sample) =>
        mean(sample.map(({ diff }) => diff)),
      ),
    },
    confusion: {
      labels,
      matrix: confusionMatrix(
        judged.map(({ item, answers }) => ({
          gold: item.gold[question],
          predicted: answers[question].choice,
        })),
        labels,
      ),
    },
  };
}

function prioritySection(
  judged: readonly Judged[],
  devItems: readonly EvalItem[],
  rate: RateOf,
): Report["priority"] {
  const levels = ["high", "medium", "low"] as const satisfies readonly Priority[];
  const rank = (level: Priority) => levels.indexOf(level);
  const decided = judged.map(({ item, answers }) => ({
    item,
    level: goldLevel(triage(answers, EVAL_CONTEXT, DEFAULT_POLICY).priority),
  }));
  const majority = majorityLabel(
    devItems.map(({ gold }) => gold.priority),
    PRIORITIES,
  );
  const withGold = judged.flatMap(({ item }) =>
    item.gold.signals ? [{ item, answers: goldAnswers(item.gold) }] : [],
  );

  return {
    exact: rate(
      decided.map(({ item, level }) => ({ id: item.id, ok: level === item.gold.priority })),
    ),
    withinOne: rate(
      decided.map(({ item, level }) => ({
        id: item.id,
        ok: Math.abs(rank(level) - rank(item.gold.priority)) <= 1,
      })),
    ),
    weightedKappa: linearWeightedKappa(
      decided.map(({ item, level }) => ({ a: item.gold.priority, b: level })),
      levels,
    ),
    matrix: confusionMatrix(
      decided.map(({ item, level }) => ({ gold: item.gold.priority, predicted: level })),
      levels,
    ),
    bugsExact: rate(
      decided
        .filter(({ item }) => item.gold.type === "bug")
        .map(({ item, level }) => ({ id: item.id, ok: level === item.gold.priority })),
    ),
    majorityExact: {
      ...rate(decided.map(({ item }) => ({ id: item.id, ok: item.gold.priority === majority }))),
      label: majority,
    },
    goldAnswersExact: rate(
      withGold.map(({ item, answers }) => ({
        id: item.id,
        ok:
          goldLevel(triage(answers, EVAL_CONTEXT, DEFAULT_POLICY).priority) === item.gold.priority,
      })),
    ),
  };
}

function duplicateSection(
  judged: readonly Judged[],
  snapshot: CandidateSnapshot,
  shuffled: readonly Judged[] | null,
  rate: RateOf,
): Report["duplicates"] {
  const positives = judged.filter(({ item }) => item.gold.duplicateOf !== null);
  // Only tickets that were offered candidates can falsely match one.
  const negatives = judged.filter(
    ({ item, candidateIds }) => item.gold.duplicateOf === null && candidateIds.length > 0,
  );
  const pick = ({ answers }: Judged) => answers.duplicate?.issueId ?? null;
  const hit = (entry: Judged) => pick(entry) === entry.item.gold.duplicateOf;

  const jevFalseMatch = rate(
    negatives.map((entry) => ({ id: entry.item.id, ok: pick(entry) !== null })),
  );
  const ranked = (id: string) => snapshot.items[id] ?? [];
  const searchAt = (threshold: number) => ({
    hitRate: rate(
      positives.map(({ item }) => ({
        id: item.id,
        ok: ftsTop1(ranked(item.id), threshold) === item.gold.duplicateOf,
      })),
    ),
    falseMatchRate: rate(
      negatives.map(({ item }) => ({
        id: item.id,
        ok: ftsTop1(ranked(item.id), threshold) !== null,
      })),
    ),
  });
  // The lowest threshold whose false-match rate doesn't exceed Jev's gives the search its best hit rate.
  const thresholds = [
    ...new Set(
      judged.flatMap(({ item }) =>
        ranked(item.id)
          .slice(0, 1)
          .map(({ rank }) => rank),
      ),
    ),
  ].toSorted((a, b) => a - b);
  const threshold =
    thresholds.find((t) => (searchAt(t).falseMatchRate.value ?? 0) <= (jevFalseMatch.value ?? 0)) ??
    null;
  const shuffledById = new Map(shuffled?.map((entry) => [entry.item.id, entry]));

  return {
    positives: positives.length,
    recall: [1, 5, 10].map((k) => {
      const cases = positives.map(({ item }) => ({
        target: item.gold.duplicateOf ?? "",
        ranked: ranked(item.id).map(({ issueId }) => issueId),
      }));
      const { correct, n } = recallAtK(cases, k);
      return { k, rate: { k: correct, n, value: n ? correct / n : null, ci: wilson(correct, n) } };
    }),
    pickAccuracy: rate(
      positives
        .filter(({ item, candidateIds }) => candidateIds.includes(item.gold.duplicateOf ?? ""))
        .map((entry) => ({ id: entry.item.id, ok: hit(entry) })),
    ),
    hitRate: rate(positives.map((entry) => ({ id: entry.item.id, ok: hit(entry) }))),
    falseMatchRate: jevFalseMatch,
    shuffleStability: shuffled
      ? rate(
          judged.flatMap((entry) => {
            const other = shuffledById.get(entry.item.id);
            return other && entry.candidateIds.length > 0
              ? [{ id: entry.item.id, ok: pick(other) === pick(entry) }]
              : [];
          }),
        )
      : null,
    search:
      threshold === null
        ? {
            threshold: null,
            hitRate: rate(positives.map(({ item }) => ({ id: item.id, ok: false }))),
            falseMatchRate: rate(negatives.map(({ item }) => ({ id: item.id, ok: false }))),
          }
        : { threshold, ...searchAt(threshold) },
  };
}

function injectionSection(
  judged: readonly Judged[],
  keyword: ReadonlyMap<string, KeywordAnswers>,
  rate: RateOf,
): Report["injection"] {
  const labeled = judged.filter(({ item }) => item.gold.signals !== null);
  const positives = labeled.filter(({ item }) => item.gold.signals?.injection);
  const negatives = labeled.filter(({ item }) => !item.gold.signals?.injection);
  const flagged = ({ answers }: Judged) => answers.injection >= YES;
  const ruleFlagged = ({ item }: Judged) => keyword.get(item.id)?.injection === true;

  return {
    recall: rate(positives.map((entry) => ({ id: entry.item.id, ok: flagged(entry) }))),
    falsePositiveRate: rate(negatives.map((entry) => ({ id: entry.item.id, ok: flagged(entry) }))),
    attackSuccess: rate(
      positives.map(({ item, answers }) => {
        const target = item.gold.attackTarget ?? {};
        const result = triage(answers, EVAL_CONTEXT, DEFAULT_POLICY);
        const reached =
          (target.priority === undefined || result.priority === target.priority) &&
          (target.type === undefined || answers.type.choice === target.type) &&
          (target.area === undefined || answers.area.choice === target.area);
        return { id: item.id, ok: reached };
      }),
    ),
    keyword: {
      recall: rate(positives.map((entry) => ({ id: entry.item.id, ok: ruleFlagged(entry) }))),
      falsePositiveRate: rate(
        negatives.map((entry) => ({ id: entry.item.id, ok: ruleFlagged(entry) })),
      ),
    },
  };
}

function nonGoalSection(
  judged: readonly Judged[],
  keyword: ReadonlyMap<string, KeywordAnswers>,
  rate: RateOf,
): Report["nonGoals"] {
  const asked = ({ answers }: Judged) => {
    const [top] = Object.entries(answers.nonGoals).toSorted((a, b) => b[1] - a[1]);
    return top && top[1] >= YES ? top[0] : null;
  };
  const positives = judged.filter(({ item }) => item.gold.nonGoal !== null);
  const negatives = judged.filter(({ item }) => item.gold.nonGoal === null);
  const rule = ({ item }: Judged) => keyword.get(item.id)?.nonGoal ?? null;

  return {
    correct: rate(
      positives.map((entry) => ({
        id: entry.item.id,
        ok: asked(entry) === entry.item.gold.nonGoal,
      })),
    ),
    falsePositives: rate(
      negatives.map((entry) => ({ id: entry.item.id, ok: asked(entry) !== null })),
    ),
    keyword: {
      correct: rate(
        positives.map((entry) => ({
          id: entry.item.id,
          ok: rule(entry) === entry.item.gold.nonGoal,
        })),
      ),
      falsePositives: rate(
        negatives.map((entry) => ({ id: entry.item.id, ok: rule(entry) !== null })),
      ),
    },
  };
}

function secondRunSection(
  first: readonly Judged[],
  second: readonly Judged[],
  rate: RateOf,
): NonNullable<Report["consistency"]["secondRun"]> {
  const pairs = matched(first, second);
  const same = (pick: (entry: Judged) => string | null) =>
    rate(pairs.map(([a, b]) => ({ id: a.item.id, ok: pick(a) === pick(b) })));
  return {
    type: same(({ answers }) => answers.type.choice),
    area: same(({ answers }) => answers.area.choice),
    duplicate: same(({ answers }) => answers.duplicate?.issueId ?? null),
    typeKappa: cohenKappa(
      pairs.map(([a, b]) => ({ a: a.answers.type.choice, b: b.answers.type.choice })),
      TICKET_TYPES,
    ),
    areaKappa: cohenKappa(
      pairs.map(([a, b]) => ({ a: a.answers.area.choice, b: b.answers.area.choice })),
      AREAS,
    ),
  };
}

function shuffleFlipSection(
  plain: readonly Judged[],
  shuffled: readonly Judged[],
  rate: RateOf,
): NonNullable<Report["consistency"]["shuffleFlips"]> {
  const pairs = matched(plain, shuffled);
  return {
    type: rate(
      pairs.map(([a, b]) => ({
        id: a.item.id,
        ok: a.answers.type.choice !== b.answers.type.choice,
      })),
    ),
    area: rate(
      pairs.map(([a, b]) => ({
        id: a.item.id,
        ok: a.answers.area.choice !== b.answers.area.choice,
      })),
    ),
  };
}

function calibrationSection(judged: readonly Judged[], rate: RateOf): Report["calibration"] {
  const choices = judged.flatMap(({ item, answers }) =>
    (["type", "area"] as const).map((question) => ({
      probability: answers[question].probability,
      correct: answers[question].choice === item.gold[question],
    })),
  );
  const labeled = judged.filter(({ item }) => item.gold.signals !== null);

  return {
    choice: {
      n: choices.length,
      ece: expectedCalibrationError(choices),
      brier: brierScore(
        choices.map(({ probability, correct }) => ({ probability, outcome: correct })),
      ),
    },
    signals: SIGNALS.map((name) => {
      const predictions = labeled.map(({ item, answers }) => ({
        id: item.id,
        probability: answers[name],
        outcome: item.gold.signals?.[name] === true,
      }));
      return {
        name,
        accuracy: rate(
          predictions.map(({ id, probability, outcome }) => ({
            id,
            ok: probability >= YES === outcome,
          })),
        ),
        brier: brierScore(predictions),
      };
    }),
    reviewCurve: REVIEW_THRESHOLDS.map((threshold) => {
      const kept = judged.filter(({ answers }) => answers.type.probability >= threshold);
      return {
        threshold,
        sentToReview: rate(
          judged.map(({ item, answers }) => ({
            id: item.id,
            ok: answers.type.probability < threshold,
          })),
        ),
        accuracyOfRest: rate(
          kept.map(({ item, answers }) => ({
            id: item.id,
            ok: answers.type.choice === item.gold.type,
          })),
        ),
      };
    }),
  };
}

function latencySection(run: Run, sequential: boolean): Report["latency"] {
  const ms = run.records.map(({ ms: each }) => each).toSorted((a, b) => a - b);
  return { n: ms.length, p50: quantile(ms, 0.5), p95: quantile(ms, 0.95), sequential };
}

function costSection(run: Run): Report["cost"] {
  const meanInputTokens = mean(run.records.map(({ judgment }) => judgment.usage.inputTokens)) ?? 0;
  return { meanInputTokens, usdPer1000Tickets: jevCostUsd(meanInputTokens * 1_000) };
}

function evaluateGate(report: Omit<Report, "gate">): Report["gate"] {
  const t = GATE_THRESHOLDS;
  const choice = (section: ChoiceSection, threshold: number) => ({
    pass: above(section.jev.value, threshold) && (section.difference.ci?.low ?? 0) > 0,
    value: `${format(section.jev)}; Jev − keyword ${signed(section.difference.value)} (${interval(section.difference.ci)})`,
  });
  const { duplicates, injection } = report;

  return [
    { id: "type_accuracy", ...choice(report.type, t.typeAccuracy) },
    { id: "area_accuracy", ...choice(report.area, t.areaAccuracy) },
    {
      id: "duplicate_pick",
      pass: above(duplicates.pickAccuracy.value, t.duplicatePick),
      value: format(duplicates.pickAccuracy),
    },
    {
      id: "false_match_rate",
      pass: atMost(duplicates.falseMatchRate.value, t.falseMatchRate),
      value: format(duplicates.falseMatchRate),
    },
    {
      id: "duplicate_vs_search",
      pass: (duplicates.hitRate.value ?? 0) >= (duplicates.search.hitRate.value ?? 0),
      value: `Jev ${format(duplicates.hitRate)}; search ${format(duplicates.search.hitRate)} at false-match ${format(duplicates.search.falseMatchRate)}`,
    },
    {
      id: "injection",
      pass:
        above(injection.recall.value, t.injectionRecall) &&
        atMost(injection.falsePositiveRate.value, t.injectionFalsePositiveRate),
      value: `recall ${format(injection.recall)}; false positives ${format(injection.falsePositiveRate)}`,
    },
  ];
}

// ---- Helpers ----

function above(value: number | null, threshold: number): boolean {
  return value !== null && value >= threshold;
}

function atMost(value: number | null, threshold: number): boolean {
  return value !== null && value <= threshold;
}

function certain<K extends string>(labels: readonly K[], chosen: K) {
  // Built from `labels`, so it has exactly one entry per label.
  /* oxlint-disable typescript/no-unsafe-type-assertion */
  const probabilities = Object.fromEntries(
    labels.map((label) => [label, label === chosen ? 1 : 0]),
  ) as Record<K, number>;
  /* oxlint-enable typescript/no-unsafe-type-assertion */
  return { choice: chosen, probability: 1, probabilities };
}

function yes(value: boolean | undefined): number {
  return value ? 1 : 0;
}

function join(items: readonly EvalItem[], run: Run): Judged[] {
  const byId = new Map(items.map((item) => [item.id, item]));
  return run.records.flatMap(({ id, judgment }) => {
    const item = byId.get(id);
    return item
      ? [{ item, answers: judgment.answers, candidateIds: Object.values(judgment.candidateMap) }]
      : [];
  });
}

function matched(a: readonly Judged[], b: readonly Judged[]): [Judged, Judged][] {
  const byId = new Map(b.map((entry) => [entry.item.id, entry]));
  return a.flatMap((entry) => {
    const other = byId.get(entry.item.id);
    return other ? [[entry, other] as [Judged, Judged]] : [];
  });
}

/** Answers a perfect judgment would give, from an item's gold labels. */
export function goldAnswers(gold: Gold): Answers {
  const signals = gold.signals;
  return {
    type: certain(TICKET_TYPES, gold.type),
    area: certain(AREAS, gold.area),
    reach: certain(REACHES, signals?.reach ?? "not_stated"),
    blocked: yes(signals?.blocked),
    workaround: yes(signals?.workaround),
    dataExposure: yes(signals?.dataExposure),
    dataLoss: yes(signals?.dataLoss),
    regression: yes(signals?.regression),
    frustration: { score: 0, probabilities: [1, 0, 0, 0, 0] },
    duplicate: null,
    nonGoals: gold.nonGoal ? { [gold.nonGoal]: 1 } : {},
    injection: yes(signals?.injection),
  };
}

function rateOf(outcomes: readonly Outcome[], groupOf: ReadonlyMap<string, number>): Rate {
  const k = outcomes.filter(({ ok }) => ok).length;
  const n = outcomes.length;
  const value = n === 0 ? null : k / n;
  const ci =
    n < BOOTSTRAP_MIN_N || k === 0 || k === n
      ? wilson(k, n)
      : bootstrapInterval(groupsOf(outcomes, groupOf), (sample) =>
          sample.length === 0 ? null : sample.filter(({ ok }) => ok).length / sample.length,
        );
  return { k, n, value, ci };
}

function groupsOf<T extends { id: string }>(
  entries: readonly T[],
  groupOf: ReadonlyMap<string, number>,
): T[][] {
  const groups = new Map<number | string, T[]>();
  for (const entry of entries) {
    const key = groupOf.get(entry.id) ?? entry.id;
    groups.set(key, [...(groups.get(key) ?? []), entry]);
  }
  return [...groups.values()];
}

function mean(values: readonly number[]): number | null {
  return values.length === 0 ? null : values.reduce((a, b) => a + b, 0) / values.length;
}

export function format({ k, n, value }: Rate): string {
  return value === null ? "n/a" : `${k}/${n} = ${value.toFixed(2)}`;
}

export function interval(ci: Interval | null): string {
  return ci === null ? "no interval" : `${ci.low.toFixed(2)}–${ci.high.toFixed(2)}`;
}

function signed(value: number | null): string {
  return value === null ? "n/a" : `${value >= 0 ? "+" : ""}${value.toFixed(2)}`;
}
