import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

import type { CorpusIssue, Priority, Tracker } from "@/lib/issue-corpus";
import type { TriagePriority } from "@/lib/priorities";
import type { Area, Reach, TicketType } from "@/lib/triage/questions";
import type { TicketInput } from "@/lib/triage/state";

import { NON_GOALS } from "@/lib/config/non-goals";
import { loadIssueCorpus, PRIORITIES, TRACKERS } from "@/lib/issue-corpus";
import { TRIAGE_PRIORITIES } from "@/lib/priorities";
import { issueToTicket } from "@/lib/triage/normalize";
import { AREAS, REACHES, TICKET_TYPES } from "@/lib/triage/questions";
import { MESSAGE_MAX_CHARS, SUBJECT_MAX_CHARS } from "@/lib/triage/state";

// Everything the eval runs on (plan M1): the issue corpus turned into tickets,
// plus the hand-written support and adversarial sets in data/eval/. Each item
// carries its gold labels. Only the hand-written sets have signal labels
// (reach, blocked, injection and so on); the corpus has none.

export const EVAL_SETS = ["corpus", "support", "adversarial"] as const;
export type EvalSet = (typeof EVAL_SETS)[number];

export type Signals = {
  reach: Reach;
  blocked: boolean;
  workaround: boolean;
  regression: boolean;
  dataExposure: boolean;
  dataLoss: boolean;
  injection: boolean;
};

/** What an injection tries to make the triage say. */
export type AttackTarget = { priority?: TriagePriority; type?: TicketType; area?: Area };

export type Gold = {
  type: TicketType;
  area: Area;
  priority: Priority;
  /** The existing issue this item duplicates, e.g. `librechat#2104`. */
  duplicateOf: string | null;
  /** The non-goal the customer asks for, by id. */
  nonGoal: string | null;
  /** `null` for corpus items, which have no signal labels. */
  signals: Signals | null;
  /** `null` unless the item contains an injection. */
  attackTarget: AttackTarget | null;
};

export type EvalItem = {
  /** `librechat#2104` for a corpus issue; `support-01` or `adversarial-01` otherwise. */
  id: string;
  set: EvalSet;
  tracker: Tracker;
  createdAt: string;
  ticket: TicketInput;
  gold: Gold;
};

const EVAL_DIR = join(import.meta.dirname, "../../../data/eval");
const HAND_WRITTEN_SETS = ["support", "adversarial"] as const;

const NON_GOAL_IDS = new Set(NON_GOALS.map(({ id }) => id));
const nonGoalId = z.string().refine((id) => NON_GOAL_IDS.has(id), "is not a known non-goal");
const issueId = z.string().regex(new RegExp(`^(?:${TRACKERS.join("|")})#\\d+$`));

const attackTargetSchema = z
  .object({
    priority: z.enum(TRIAGE_PRIORITIES).optional(),
    type: z.enum(TICKET_TYPES).optional(),
    area: z.enum(AREAS).optional(),
  })
  .strict()
  .refine((target) => Object.keys(target).length > 0, "must name at least one target");

function handWrittenFile(set: (typeof HAND_WRITTEN_SETS)[number]) {
  const ticket = z
    .object({
      id: z.string().regex(new RegExp(`^${set}-\\d{2}$`)),
      tracker: z.enum(TRACKERS),
      createdAt: z.iso.datetime(),
      subject: z.string().min(1).max(SUBJECT_MAX_CHARS),
      // Within the state's caps, so the model sees every word the labels describe.
      messages: z
        .array(
          z
            .object({
              from: z.enum(["customer", "support"]),
              text: z.string().min(1).max(MESSAGE_MAX_CHARS),
            })
            .strict(),
        )
        .min(1)
        .refine(([first]) => first?.from === "customer", "must start with the customer"),
      gold: z
        .object({
          type: z.enum(TICKET_TYPES),
          area: z.enum(AREAS),
          priority: z.enum(PRIORITIES),
          reach: z.enum(REACHES),
          blocked: z.boolean(),
          workaround: z.boolean(),
          regression: z.boolean(),
          dataExposure: z.boolean(),
          dataLoss: z.boolean(),
          nonGoal: nonGoalId.nullable(),
          injection: z.boolean(),
          duplicateOf: issueId.nullable(),
          attackTarget: attackTargetSchema.nullable(),
        })
        .strict(),
    })
    .strict();

  return z.object({ set: z.literal(set), note: z.string(), tickets: z.array(ticket) }).strict();
}

const corpusNonGoalsFile = z
  .object({ note: z.string(), nonGoals: z.record(issueId, nonGoalId) })
  .strict();

export function loadEvalItems({
  corpusDir,
  evalDir = EVAL_DIR,
}: { corpusDir?: string; evalDir?: string } = {}): EvalItem[] {
  const corpus = loadIssueCorpus(corpusDir);
  const issues = new Map(corpus.map((issue) => [issue.id, issue]));

  const { nonGoals } = corpusNonGoalsFile.parse(readJson(join(evalDir, "corpus-nongoals.json")));
  for (const id of Object.keys(nonGoals)) {
    if (!issues.has(id)) throw new Error(`corpus-nongoals.json names a missing issue ${id}`);
  }

  const items = [
    ...corpus.map((issue) => corpusItem(issue, nonGoals[issue.id] ?? null)),
    ...HAND_WRITTEN_SETS.flatMap((set) =>
      handWrittenFile(set)
        .parse(readJson(join(evalDir, `${set}.json`)))
        .tickets.map(({ id, tracker, createdAt, subject, messages, gold }): EvalItem => {
          const { reach, blocked, workaround, regression, dataExposure, dataLoss, injection } =
            gold;
          return {
            id,
            set,
            tracker,
            createdAt,
            ticket: { subject, messages },
            gold: {
              type: gold.type,
              area: gold.area,
              priority: gold.priority,
              duplicateOf: gold.duplicateOf,
              nonGoal: gold.nonGoal,
              signals: {
                reach,
                blocked,
                workaround,
                regression,
                dataExposure,
                dataLoss,
                injection,
              },
              attackTarget: gold.attackTarget,
            },
          };
        }),
    ),
  ];

  checkConsistency(items, issues);
  return items;
}

function corpusItem(issue: CorpusIssue, nonGoal: string | null): EvalItem {
  return {
    id: issue.id,
    set: "corpus",
    tracker: issue.tracker,
    createdAt: issue.createdAt,
    ticket: issueToTicket(issue),
    gold: {
      type: issue.type,
      area: issue.area,
      priority: issue.priority,
      duplicateOf: issue.duplicateOf === null ? null : `${issue.tracker}#${issue.duplicateOf}`,
      nonGoal,
      signals: null,
      attackTarget: null,
    },
  };
}

// The corpus loader already checks the corpus's own duplicates; this checks
// the hand-written items against it.
function checkConsistency(items: readonly EvalItem[], issues: ReadonlyMap<string, CorpusIssue>) {
  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item.id)) throw new Error(`${item.id} appears more than once`);
    seen.add(item.id);
    if (item.set === "corpus") continue;

    const { duplicateOf, signals, attackTarget } = item.gold;
    if (signals?.injection !== (attackTarget !== null)) {
      throw new Error(`${item.id} must have an attackTarget exactly when it has an injection`);
    }
    if (duplicateOf === null) continue;

    const original = issues.get(duplicateOf);
    if (!original) throw new Error(`${item.id} duplicates a missing issue ${duplicateOf}`);
    if (original.tracker !== item.tracker) {
      throw new Error(`${item.id} duplicates ${duplicateOf} from another tracker`);
    }
    if (original.duplicateOf !== null) {
      throw new Error(`${item.id} duplicates ${duplicateOf}, which is itself a duplicate`);
    }
    if (original.createdAt >= item.createdAt) {
      throw new Error(`${item.id} duplicates ${duplicateOf}, which is newer`);
    }
  }
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}
