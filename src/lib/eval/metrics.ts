// Agreement between gold labels and a judgment provider's answers. Pure and
// unit-tested; the confidence intervals and the rest of the report come in M3.

export type LabelPair<L extends string> = { gold: L; predicted: L };

export type Accuracy = { correct: number; n: number; value: number | null };

export function accuracy<L extends string>(pairs: readonly LabelPair<L>[]): Accuracy {
  const correct = pairs.filter(({ gold, predicted }) => gold === predicted).length;
  return { correct, n: pairs.length, value: pairs.length === 0 ? null : correct / pairs.length };
}

/** Rows are gold labels and columns are predicted labels, both in `labels` order. */
export function confusionMatrix<L extends string>(
  pairs: readonly LabelPair<L>[],
  labels: readonly L[],
): number[][] {
  const index = new Map(labels.map((label, i) => [label, i]));
  const matrix = labels.map(() => labels.map(() => 0));
  for (const { gold, predicted } of pairs) {
    const row = index.get(gold);
    const column = index.get(predicted);
    if (row === undefined || column === undefined) {
      throw new RangeError(`Unknown label in pair ${gold} → ${predicted}`);
    }
    const cells = matrix[row];
    if (cells) cells[column] = (cells[column] ?? 0) + 1;
  }
  return matrix;
}
