import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

import { TICKET_TYPES } from "@/lib/triage/questions";

import type { EvalItem } from "./sets";

import { EVAL_SETS } from "./sets";

// The frozen dev/test split (plan M1). Questions, keyword rules and thresholds
// are tuned on dev only; test is run once the question set is frozen.
//
// Items that could teach each other the answer stay on one side: a duplicate
// and its original, and the corpus issues that mirror each other across the
// two trackers (data/eval/groups.json). Groups are sorted by set, whether they
// hold an injection, whether they hold a duplicate, gold type and finally a
// hash, and every third group in that order goes to dev. Taking every third of
// a sorted list spreads each of those evenly over both parts. The same inputs
// always give the same split.

export const SPLIT_VERSION = "v1";
export const SPLIT_PARTS = ["dev", "test"] as const;
export type SplitPart = (typeof SPLIT_PARTS)[number];

export type Split = { version: string; dev: string[]; test: string[] };

/** Every n-th group goes to dev. */
const DEV_EVERY = 3;
/** Dev must hold at least this many of each, or tuning on it means little. */
export const MIN_DEV_DUPLICATES = 6;
export const MIN_DEV_INJECTIONS = 6;

const GROUPS_FILE = join(import.meta.dirname, "../../../data/eval/groups.json");
export const SPLIT_FILE = join(import.meta.dirname, `../../../eval/splits/${SPLIT_VERSION}.json`);

const groupsFile = z
  .object({ note: z.string(), mirrors: z.array(z.tuple([z.string(), z.string()])) })
  .strict();

export function loadMirrors(path: string = GROUPS_FILE): [string, string][] {
  return groupsFile.parse(JSON.parse(readFileSync(path, "utf8"))).mirrors;
}

export function buildSplit(
  items: readonly EvalItem[],
  mirrors: readonly (readonly [string, string])[],
): Split {
  const groups = groupItems(items, mirrors);
  const byId = new Map(items.map((item) => [item.id, item]));

  const ordered = groups
    .map((ids) => ({ ids, stratum: stratum(ids, byId), hash: hash(ids) }))
    .toSorted((a, b) => compare(a.stratum, b.stratum) || compare(a.hash, b.hash));

  const dev = ordered.filter((_, index) => index % DEV_EVERY === 0).flatMap(({ ids }) => ids);
  const devIds = new Set(dev);
  return {
    version: SPLIT_VERSION,
    dev: dev.toSorted(compare),
    test: items
      .map(({ id }) => id)
      .filter((id) => !devIds.has(id))
      .toSorted(compare),
  };
}

/** Throws unless dev holds every type, enough duplicates and enough injections. */
export function checkSplit(split: Split, items: readonly EvalItem[]): void {
  const dev = new Set(split.dev);
  const devItems = items.filter(({ id }) => dev.has(id));
  const problems = TICKET_TYPES.filter(
    (type) => !devItems.some(({ gold }) => gold.type === type),
  ).map((type) => `no ${type} item`);
  const duplicates = devItems.filter(({ gold }) => gold.duplicateOf !== null).length;
  if (duplicates < MIN_DEV_DUPLICATES) problems.push(`only ${duplicates} duplicates`);
  const injections = devItems.filter(({ gold }) => gold.signals?.injection).length;
  if (injections < MIN_DEV_INJECTIONS) problems.push(`only ${injections} injections`);

  if (problems.length > 0) throw new Error(`Dev split is too thin: ${problems.join(", ")}`);
}

/** The ids of one split part, after checking the split still covers exactly these items. */
export function splitPart(split: Split, items: readonly EvalItem[], part: SplitPart): string[] {
  const inSplit = new Set([...split.dev, ...split.test]);
  const stale =
    inSplit.size !== split.dev.length + split.test.length ||
    inSplit.size !== items.length ||
    items.some(({ id }) => !inSplit.has(id));
  if (stale) throw new Error("The split doesn't match the eval items; run `pnpm eval:split`");
  return split[part];
}

export function readSplit(path: string = SPLIT_FILE): Split {
  return z
    .object({ version: z.string(), dev: z.array(z.string()), test: z.array(z.string()) })
    .strict()
    .parse(JSON.parse(readFileSync(path, "utf8")));
}

export function serializeSplit(split: Split): string {
  return `${JSON.stringify(split, null, 2)}\n`;
}

/** Connected components over duplicate edges and mirror pairs, each sorted: the units
 * the split keeps together and the bootstrap resamples. */
export function groupItems(
  items: readonly EvalItem[],
  mirrors: readonly (readonly [string, string])[],
): string[][] {
  const parent = new Map(items.map(({ id }) => [id, id]));
  const root = (id: string): string => {
    const up = parent.get(id);
    if (up === undefined) throw new Error(`${id} is not an eval item`);
    if (up === id) return id;
    const top = root(up);
    parent.set(id, top);
    return top;
  };
  const union = (a: string, b: string) => parent.set(root(a), root(b));

  for (const [a, b] of mirrors) union(a, b);
  for (const { id, gold } of items) if (gold.duplicateOf !== null) union(id, gold.duplicateOf);

  const groups = new Map<string, string[]>();
  for (const { id } of items) groups.set(root(id), [...(groups.get(root(id)) ?? []), id]);
  return [...groups.values()].map((ids) => ids.toSorted(compare));
}

// A group's set and type come from its lead member, the first one in set
// order (corpus, support, adversarial), so a corpus original leads its
// duplicates. The injection and duplicate flags hold if any member has one.
function stratum(ids: readonly string[], byId: ReadonlyMap<string, EvalItem>): string {
  const members = ids.map((id) => byId.get(id)).filter((item) => item !== undefined);
  const [lead] = members.toSorted((a, b) => EVAL_SETS.indexOf(a.set) - EVAL_SETS.indexOf(b.set));
  const injection = members.some(({ gold }) => gold.signals?.injection);
  const duplicate = members.some(({ gold }) => gold.duplicateOf !== null);
  return [
    lead ? EVAL_SETS.indexOf(lead.set) : -1,
    injection ? "injection" : "clean",
    duplicate ? "duplicate" : "single",
    lead?.gold.type,
  ].join("|");
}

function hash(ids: readonly string[]): string {
  return createHash("sha256")
    .update(`${SPLIT_VERSION}:${ids.join(",")}`)
    .digest("hex");
}

// Code-unit order, so the split doesn't depend on the machine's locale.
function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
