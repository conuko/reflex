import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

import type { Area, TicketType } from "@/lib/triage/questions";
import type { TicketState } from "@/lib/triage/state";

import { AREAS, TICKET_TYPES } from "@/lib/triage/questions";

// A reference baseline in plain code (ADR-0003): keyword rules that answer
// type, area, injection and non-goals, so every eval number for Jev can be
// shown next to what code alone achieves.
//
// v0 is derived mechanically from the question text, with no tuning: an
// option's keywords are the content words of its `what` and `examples`,
// minus every word another option of the same question uses as well. The
// derived rules are frozen in data/eval/keyword-rules/<version>.json and
// pinned by a hash; a revision (at most 3, on dev only) is a new file and a
// new version.

export const KEYWORD_RULES_VERSION = "v1";

/** sha256 of each frozen rules file; a test fails if a frozen file changes. */
export const KEYWORD_RULE_HASHES: Record<string, string> = {
  v0: "fa034dd6a22fca1e7b31ab757847e62fbf9c697fcb0ce92ae6d3dc775ec91311",
  // v1: the one dev-only revision, hand-written from v0's misses on dev (plan M3).
  v1: "7ec593c1a46d9b1a3f056e5f4d337cdbd3f3c465cdacc1b5a03c8c22855cefd1",
};

/** Matching keywords needed before the rules answer yes for injection or a non-goal. */
export const MIN_YES_HITS = 2;

const RULES_DIR = join(import.meta.dirname, "../../../../data/eval/keyword-rules");

const keywords = z.array(z.string().min(1));
const rulesSchema = z
  .object({
    version: z.string(),
    type: z.record(z.enum(TICKET_TYPES), keywords),
    area: z.record(z.enum(AREAS), keywords),
    injection: keywords,
    nonGoals: z.record(z.string(), keywords),
  })
  .strict();

export type KeywordRules = z.infer<typeof rulesSchema>;

export type KeywordAnswers = {
  type: TicketType;
  area: Area;
  injection: boolean;
  /** The non-goal with the most matching keywords, if it has at least MIN_YES_HITS. */
  nonGoal: string | null;
  /** Whether a keyword matched, rather than the fallback answering. */
  matched: { type: boolean; area: boolean };
};

/** The labels the rules fall back to when no keyword matches: the dev majority. */
export type KeywordFallback = { type: TicketType; area: Area };

export function rulesFile(version: string = KEYWORD_RULES_VERSION): string {
  return join(RULES_DIR, `${version}.json`);
}

export function loadKeywordRules(version: string = KEYWORD_RULES_VERSION): KeywordRules {
  return rulesSchema.parse(JSON.parse(readFileSync(rulesFile(version), "utf8")));
}

export function hashRulesFile(version: string = KEYWORD_RULES_VERSION): string {
  return createHash("sha256")
    .update(readFileSync(rulesFile(version)))
    .digest("hex");
}

export function predictWithKeywords(
  state: TicketState,
  rules: KeywordRules,
  fallback: KeywordFallback,
): KeywordAnswers {
  const words = new Set(
    stems([state.ticket.subject, ...state.ticket.messages.map(({ text }) => text)].join(" ")),
  );
  const hits = (list: readonly string[]) => list.filter((word) => words.has(word)).length;

  const nonGoal = Object.entries(rules.nonGoals)
    .map(([id, list]) => ({ id, count: hits(list) }))
    .filter(({ count }) => count >= MIN_YES_HITS)
    .toSorted((a, b) => b.count - a.count)[0];

  const type = best(TICKET_TYPES, (label) => hits(rules.type[label] ?? []));
  const area = best(AREAS, (label) => hits(rules.area[label] ?? []));
  return {
    type: type ?? fallback.type,
    area: area ?? fallback.area,
    matched: { type: type !== undefined, area: area !== undefined },
    injection: hits(rules.injection) >= MIN_YES_HITS,
    nonGoal: nonGoal?.id ?? null,
  };
}

// The label with the most hits; ties go to the label listed first. Undefined when nothing matched.
function best<L extends string>(labels: readonly L[], count: (label: L) => number): L | undefined {
  let top: { label: L; count: number } | undefined;
  for (const label of labels) {
    const n = count(label);
    if (n > 0 && (!top || n > top.count)) top = { label, count: n };
  }
  return top?.label;
}

// ---- Deriving v0 from the question text ----

type Criterion = { what: string; examples?: readonly string[] };

const criterion = z.object({ what: z.string(), examples: z.array(z.string()).optional() });
const questionSetText = z.object({
  type: z.object({ criteria: z.record(z.string(), criterion) }),
  area: z.object({ criteria: z.record(z.string(), criterion) }),
  injection: z.object({ criteria: z.object({ true: criterion, false: criterion }) }),
});
const nonGoalQuestion = z.object({ instructions: z.object({ non_goal: criterion }) });

/** Derives keyword rules from a question set as sent to the model (e.g. the frozen v1 snapshot). */
export function deriveKeywordRules(questionSet: unknown, version: string): KeywordRules {
  const set = questionSetText.parse(questionSet);
  const nonGoals = Object.fromEntries(
    Object.entries(z.record(z.string(), z.unknown()).parse(questionSet))
      .filter(([id]) => id.startsWith("nongoal_"))
      .map(([id, question]) => [
        id.slice("nongoal_".length),
        nonGoalQuestion.parse(question).instructions.non_goal,
      ]),
  );

  // Parsed, so the result is checked to cover every type and area.
  return rulesSchema.parse({
    version,
    type: distinctive(TICKET_TYPES, set.type.criteria),
    area: distinctive(AREAS, set.area.criteria),
    injection: distinctive(["true", "false"], set.injection.criteria).true ?? [],
    nonGoals: distinctive(Object.keys(nonGoals), nonGoals),
  });
}

// Each option's content words, minus words any other option uses too.
function distinctive(
  labels: readonly string[],
  criteria: Partial<Record<string, Criterion>>,
): Record<string, string[]> {
  const bags = new Map(
    labels.map((label) => {
      const { what = "", examples = [] } = criteria[label] ?? {};
      return [label, new Set(stems([what, ...examples].join(" ")))];
    }),
  );
  return Object.fromEntries(
    labels.map((label) => {
      const others = labels.filter((other) => other !== label).map((other) => bags.get(other));
      const own = [...(bags.get(label) ?? [])].filter(
        (word) => !others.some((bag) => bag?.has(word)),
      );
      return [label, own.toSorted()];
    }),
  );
}

const STOPWORDS = new Set(
  "the and for with from that this these those are was were been being have has had not but can could would should will shall may might must its it's into onto than then them they their there here what when where which who whom whose why how all any each every some such only own same other another also just very more most less least our ours your yours his her him she you who about above after again against before below between both down during further once over under until while why off out own too few nor".split(
    " ",
  ),
);

/** Lowercased content words, cut to a crude stem: a trailing "s" dropped, then at most 6 letters. */
export function stems(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 3 && !STOPWORDS.has(word))
    .map((word) =>
      word.length > 3 && word.endsWith("s") && !word.endsWith("ss") ? word.slice(0, -1) : word,
    )
    .map((word) => word.slice(0, 6));
}
