// `pnpm eval:fts`: how often the duplicate candidate search finds the true
// original, from the committed snapshot (`pnpm eval:candidates`). No model
// calls and no database. This caps how well any duplicate pick can do.

import { readCandidateSnapshot } from "@/lib/eval/candidates-snapshot";
import { recallAtK } from "@/lib/eval/metrics";
import { EVAL_SETS, loadEvalItems } from "@/lib/eval/sets";

const KS = [1, 5, 10] as const;
const RECALL_TARGET = { k: 10, value: 0.6 };

const snapshot = readCandidateSnapshot();
const duplicates = loadEvalItems().flatMap((item) =>
  item.gold.duplicateOf === null
    ? []
    : [
        {
          set: item.set,
          target: item.gold.duplicateOf,
          ranked: (snapshot.items[item.id] ?? []).map(({ issueId }) => issueId),
        },
      ],
);

console.log(
  `candidate search ${snapshot.version}, ${snapshot.searchTerms} terms, ${duplicates.length} duplicates\n`,
);
console.log(["set".padEnd(14), ...KS.map((k) => `recall@${k}`.padEnd(18))].join(""));
for (const set of [...EVAL_SETS, "all"] as const) {
  const cases = set === "all" ? duplicates : duplicates.filter((item) => item.set === set);
  if (cases.length === 0) continue;
  const cells = KS.map((k) => {
    const { correct, n, value } = recallAtK(cases, k);
    return `${correct}/${n} = ${value?.toFixed(2)}`.padEnd(18);
  });
  console.log([set.padEnd(14), ...cells].join(""));
}

const { value } = recallAtK(duplicates, RECALL_TARGET.k);
const met = value !== null && value >= RECALL_TARGET.value;
console.log(
  `\nrecall@${RECALL_TARGET.k} target ${RECALL_TARGET.value}: ${met ? "met" : "missed (add pg_trgm title similarity, plan M2)"}`,
);
