import { describe, expect, it } from "vitest";

import { accuracy, confusionMatrix } from "@/lib/eval/metrics";

const pairs = [
  { gold: "bug", predicted: "bug" },
  { gold: "bug", predicted: "question" },
  { gold: "question", predicted: "question" },
  { gold: "other", predicted: "bug" },
] as const;

describe("accuracy", () => {
  it("counts the answers that match the gold label", () => {
    expect(accuracy(pairs)).toEqual({ correct: 2, n: 4, value: 0.5 });
  });

  it("has no value without pairs", () => {
    expect(accuracy([])).toEqual({ correct: 0, n: 0, value: null });
  });
});

describe("confusionMatrix", () => {
  it("counts gold labels by row and answers by column", () => {
    expect(confusionMatrix(pairs, ["bug", "question", "other"])).toEqual([
      [1, 1, 0],
      [0, 1, 0],
      [1, 0, 0],
    ]);
  });

  it("refuses a label it wasn't given", () => {
    expect(() => confusionMatrix(pairs, ["bug", "question"])).toThrow("Unknown label");
  });
});
