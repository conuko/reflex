import { describe, expect, it } from "vitest";

import {
  bootstrapInterval,
  brierScore,
  cohenKappa,
  expectedCalibrationError,
  linearWeightedKappa,
  mcnemarExact,
  quantile,
  wilson,
} from "@/lib/eval/stats";

// Expected values are worked out by hand in the comments.

describe("wilson", () => {
  it("matches the textbook interval for 8 of 10", () => {
    // center (0.8 + 1.96²/20) / (1 + 1.96²/10) = 0.7167, half-width 0.2266
    const interval = wilson(8, 10);

    expect(interval?.low).toBeCloseTo(0.4902, 4);
    expect(interval?.high).toBeCloseTo(0.9433, 4);
  });

  it("starts at 0 for no successes and ends at 1 for all", () => {
    expect(wilson(0, 7)).toEqual({ low: 0, high: expect.closeTo(0.3543, 4) });
    expect(wilson(7, 7)?.high).toBe(1);
  });

  it("has no interval without trials", () => {
    expect(wilson(0, 0)).toBeNull();
  });
});

describe("mcnemarExact", () => {
  it("doubles the binomial tail of the smaller discordant count", () => {
    // n = 7: (C(7,0) + C(7,1)) / 2^7 = 8/128, doubled
    expect(mcnemarExact(1, 6)).toBeCloseTo(0.125, 10);
    expect(mcnemarExact(6, 1)).toBeCloseTo(0.125, 10);
  });

  it("is 1 without discordant pairs or with a balanced split", () => {
    expect(mcnemarExact(0, 0)).toBe(1);
    expect(mcnemarExact(5, 5)).toBe(1);
  });
});

describe("kappa", () => {
  it("corrects agreement for chance", () => {
    // agreement 3/4; chance (2·1 + 2·3) / 16 = 1/2; (0.75 − 0.5) / 0.5
    const pairs = [
      { a: "x", b: "x" },
      { a: "x", b: "y" },
      { a: "y", b: "y" },
      { a: "y", b: "y" },
    ] as const;

    expect(cohenKappa(pairs, ["x", "y"])).toBeCloseTo(0.5, 10);
  });

  it("weights disagreements by their distance on an ordered scale", () => {
    // observed weighted disagreement 0.5/3; expected 0.5; 1 − (1/6) / 0.5
    const pairs = [
      { a: "low", b: "low" },
      { a: "medium", b: "high" },
      { a: "high", b: "high" },
    ] as const;

    expect(linearWeightedKappa(pairs, ["low", "medium", "high"])).toBeCloseTo(2 / 3, 10);
  });

  it("has no value without pairs", () => {
    expect(cohenKappa([], ["x"])).toBeNull();
  });
});

describe("expectedCalibrationError", () => {
  it("averages the gap between accuracy and probability over equal-mass bins", () => {
    // bins {0.3 wrong, 0.6 right} and {0.8 wrong, 0.9 right}: |0.5 − 0.45|/2 + |0.5 − 0.85|/2
    const predictions = [
      { probability: 0.9, correct: true },
      { probability: 0.8, correct: false },
      { probability: 0.6, correct: true },
      { probability: 0.3, correct: false },
    ];

    expect(expectedCalibrationError(predictions, 2)).toBeCloseTo(0.2, 10);
  });

  it("is 0 for perfectly calibrated bins", () => {
    expect(
      expectedCalibrationError([
        { probability: 1, correct: true },
        { probability: 0, correct: false },
      ]),
    ).toBe(0);
  });
});

describe("brierScore", () => {
  it("is the mean squared gap to the outcome", () => {
    // ((0.9 − 1)² + (0.2 − 0)²) / 2
    expect(
      brierScore([
        { probability: 0.9, outcome: true },
        { probability: 0.2, outcome: false },
      ]),
    ).toBeCloseTo(0.025, 10);
  });
});

describe("quantile", () => {
  it("interpolates between sorted values", () => {
    const values = Array.from({ length: 10 }, (_, i) => i + 1);

    expect(quantile(values, 0.5)).toBe(5.5);
    expect(quantile(values, 0.95)).toBeCloseTo(9.55, 10);
    expect(quantile([4], 0.95)).toBe(4);
  });
});

const mean = (sample: readonly number[]) => sample.reduce((a, b) => a + b, 0) / sample.length;

describe("bootstrapInterval", () => {
  it("resamples whole groups", () => {
    // Two draws from groups of 3 and 1 items give samples of 2, 4 or 6 items.
    const interval = bootstrapInterval([["a", "b", "c"], ["d"]], (sample) => sample.length);

    expect(interval).toEqual({ low: 2, high: 6 });
  });

  it("collapses to the value when every group agrees", () => {
    expect(bootstrapInterval([[1], [1, 1], [1]], mean)).toEqual({ low: 1, high: 1 });
  });

  it("gives the same interval for the same seed", () => {
    const groups = Array.from({ length: 30 }, (_, i) => [i % 3 === 0 ? 1 : 0]);
    expect(bootstrapInterval(groups, mean, { seed: 9 })).toEqual(
      bootstrapInterval(groups, mean, { seed: 9 }),
    );
  });

  it("has no interval when the statistic has no value", () => {
    expect(bootstrapInterval([[1]], () => null)).toBeNull();
  });
});
