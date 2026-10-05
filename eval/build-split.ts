// `pnpm eval:split`: builds the frozen dev/test split over every eval item and
// writes eval/splits/v1.json. Running it twice gives a byte-identical file.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { EVAL_SETS, loadEvalItems } from "@/lib/eval/sets";
import {
  buildSplit,
  checkSplit,
  loadMirrors,
  serializeSplit,
  SPLIT_FILE,
  SPLIT_PARTS,
} from "@/lib/eval/split";

const items = loadEvalItems();
const split = buildSplit(items, loadMirrors());
checkSplit(split, items);

mkdirSync(dirname(SPLIT_FILE), { recursive: true });
writeFileSync(SPLIT_FILE, serializeSplit(split));
console.log(`wrote ${SPLIT_FILE}\n`);

const partOf = new Map(SPLIT_PARTS.flatMap((part) => split[part].map((id) => [id, part])));
const row = (label: string, subset: typeof items) =>
  [label]
    .concat(SPLIT_PARTS.map((part) => count(subset.filter(({ id }) => partOf.get(id) === part))))
    .map((cell) => cell.padEnd(36))
    .join("");

console.log(["set", ...SPLIT_PARTS].map((cell) => cell.padEnd(36)).join(""));
for (const set of EVAL_SETS) {
  const inSet = items.filter((item) => item.set === set);
  console.log(row(set, inSet));
}
console.log(row("all", items));

function count(part: typeof items): string {
  const duplicates = part.filter(({ gold }) => gold.duplicateOf !== null).length;
  const injections = part.filter(({ gold }) => gold.signals?.injection).length;
  return `${part.length} (${duplicates} dup, ${injections} inj)`;
}
