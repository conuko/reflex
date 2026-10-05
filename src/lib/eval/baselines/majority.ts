// A reference baseline in plain code (ADR-0003): always answer the label that
// is most common among the dev items. Any accuracy below this means the
// answers carry no information.

/** The most common label; a tie goes to the label listed first in `order`. */
export function majorityLabel<L extends string>(labels: readonly L[], order: readonly L[]): L {
  const counts = new Map<L, number>();
  for (const label of labels) counts.set(label, (counts.get(label) ?? 0) + 1);

  let top: L | undefined;
  for (const label of order) {
    if (top === undefined || (counts.get(label) ?? 0) > (counts.get(top) ?? 0)) top = label;
  }
  if (top === undefined) throw new RangeError("majorityLabel needs at least one label in order");
  return top;
}
