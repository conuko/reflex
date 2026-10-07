import { seededRandom } from "@/lib/random";

// The statistics of the eval report (plan M3). Pure, and unit-tested against
// hand-computed values. The sets are small, so every figure is reported with
// its n and an interval.

export type Interval = { low: number; high: number };

const Z_95 = 1.959_964;

/** Wilson score interval for k successes in n trials; null without trials. */
export function wilson(k: number, n: number, z: number = Z_95): Interval | null {
  if (n === 0) return null;
  const p = k / n;
  const denominator = 1 + (z * z) / n;
  const center = (p + (z * z) / (2 * n)) / denominator;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denominator;
  return { low: Math.max(0, center - half), high: Math.min(1, center + half) };
}

/**
 * Percentile bootstrap over groups: whole groups are resampled with
 * replacement, so items that belong together (a duplicate and its original,
 * mirror issues) are never split. Null when the statistic has no value.
 */
export function bootstrapInterval<T>(
  groups: readonly (readonly T[])[],
  statistic: (sample: readonly T[]) => number | null,
  { iterations = 2_000, seed = 1, level = 0.95 } = {},
): Interval | null {
  if (groups.length === 0 || statistic(groups.flat()) === null) return null;
  const random = seededRandom(seed);
  const values: number[] = [];
  for (let i = 0; i < iterations; i++) {
    const sample = Array.from(
      { length: groups.length },
      () => groups[Math.floor(random() * groups.length)] ?? [],
    ).flat();
    const value = statistic(sample);
    if (value !== null) values.push(value);
  }
  values.sort((a, b) => a - b);
  const tail = (1 - level) / 2;
  return { low: quantile(values, tail), high: quantile(values, 1 - tail) };
}

/** Exact two-sided McNemar test on the discordant pairs: b where only A is right, c where only B is. */
export function mcnemarExact(b: number, c: number): number {
  const n = b + c;
  if (n === 0) return 1;
  let tail = 0;
  for (let i = 0; i <= Math.min(b, c); i++) tail += binomial(n, i);
  return Math.min(1, (2 * tail) / 2 ** n);
}

/** Cohen's kappa between two labelings of the same items. */
export function cohenKappa<L extends string>(
  pairs: readonly { a: L; b: L }[],
  labels: readonly L[],
): number | null {
  return weightedKappa(pairs, labels, (i, j) => (i === j ? 0 : 1));
}

/** Weighted kappa for ordered labels, with linear disagreement weights. */
export function linearWeightedKappa<L extends string>(
  pairs: readonly { a: L; b: L }[],
  ordered: readonly L[],
): number | null {
  return weightedKappa(pairs, ordered, (i, j) => Math.abs(i - j) / (ordered.length - 1));
}

function weightedKappa<L extends string>(
  pairs: readonly { a: L; b: L }[],
  labels: readonly L[],
  weight: (i: number, j: number) => number,
): number | null {
  const n = pairs.length;
  if (n === 0) return null;
  const index = new Map(labels.map((label, i) => [label, i]));
  const rows = labels.map(() => 0);
  const columns = labels.map(() => 0);
  let observed = 0;
  for (const { a, b } of pairs) {
    const i = index.get(a);
    const j = index.get(b);
    if (i === undefined || j === undefined) throw new RangeError(`Unknown label in ${a} / ${b}`);
    rows[i] = (rows[i] ?? 0) + 1;
    columns[j] = (columns[j] ?? 0) + 1;
    observed += weight(i, j) / n;
  }
  let expected = 0;
  for (const [i, row] of rows.entries()) {
    for (const [j, column] of columns.entries())
      expected += (weight(i, j) * row * column) / (n * n);
  }
  return expected === 0 ? null : 1 - observed / expected;
}

export type CalibrationBin = {
  n: number;
  /** Mean probability of the bin's predictions. */
  confidence: number;
  /** Share of the bin's predictions that were right. */
  accuracy: number;
};

/**
 * Equal-mass bins: predictions sorted by probability and cut into `bins`
 * groups of (nearly) equal size. Empty bins are left out.
 */
export function calibrationBins(
  predictions: readonly { probability: number; correct: boolean }[],
  bins = 5,
): CalibrationBin[] {
  const n = predictions.length;
  const sorted = predictions.toSorted((a, b) => a.probability - b.probability);
  const result: CalibrationBin[] = [];
  for (let bin = 0; bin < bins; bin++) {
    const members = sorted.slice(Math.round((bin * n) / bins), Math.round(((bin + 1) * n) / bins));
    if (members.length === 0) continue;
    result.push({
      n: members.length,
      confidence: members.reduce((sum, { probability }) => sum + probability, 0) / members.length,
      accuracy: members.filter(({ correct }) => correct).length / members.length,
    });
  }
  return result;
}

/**
 * Expected calibration error over equal-mass bins (see `calibrationBins`):
 * each bin contributes its share times the gap between its accuracy and mean probability.
 */
export function expectedCalibrationError(
  predictions: readonly { probability: number; correct: boolean }[],
  bins = 5,
): number | null {
  const n = predictions.length;
  if (n === 0) return null;
  return calibrationBins(predictions, bins).reduce(
    (error, bin) => error + (bin.n / n) * Math.abs(bin.accuracy - bin.confidence),
    0,
  );
}

/** Mean squared gap between each probability and what happened (1 or 0). */
export function brierScore(
  predictions: readonly { probability: number; outcome: boolean }[],
): number | null {
  if (predictions.length === 0) return null;
  return (
    predictions.reduce(
      (sum, { probability, outcome }) => sum + (probability - (outcome ? 1 : 0)) ** 2,
      0,
    ) / predictions.length
  );
}

/** The q-quantile of sorted values by linear interpolation; NaN without values. */
export function quantile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return Number.NaN;
  const position = (sorted.length - 1) * q;
  const below = Math.floor(position);
  const lower = sorted[below] ?? Number.NaN;
  const upper = sorted[Math.min(below + 1, sorted.length - 1)] ?? lower;
  return lower + (upper - lower) * (position - below);
}

function binomial(n: number, k: number): number {
  let result = 1;
  for (let i = 1; i <= k; i++) result = (result * (n - k + i)) / i;
  return result;
}
