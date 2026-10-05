import { z } from "zod";

import type { NonGoal } from "@/lib/config/non-goals";

import type { Area, CandidateMap, Reach, TicketType } from "./questions";

import { AREAS, NO_DUPLICATE, NONGOAL_PREFIX, REACHES, TICKET_TYPES } from "./questions";

// Validates a System One response against the question set it answered, and
// reshapes it into the answers a policy reads. A choice keeps the probability
// of the chosen option and the full distribution; a yes/no answer is the
// probability of yes. The SDK's `confidence` field is dropped on purpose:
// yes/no answers don't have one, and calibration uses the probability.

export type ChoiceAnswer<K extends string> = {
  choice: K;
  probability: number;
  probabilities: Record<K, number>;
};

export type Answers = {
  type: ChoiceAnswer<TicketType>;
  area: ChoiceAnswer<Area>;
  reach: ChoiceAnswer<Reach>;
  /** Probability of yes. */
  blocked: number;
  workaround: number;
  dataExposure: number;
  dataLoss: number;
  regression: number;
  /** Expected level from 0 (calm) to 4 (threatening to leave), and each level's probability. */
  frustration: { score: number; probabilities: number[] };
  /** `null` when no candidates were offered. `issueId` is `null` when the answer is none. */
  duplicate: (ChoiceAnswer<string> & { issueId: string | null }) | null;
  /** Probability that the customer asks for each non-goal, by non-goal id. */
  nonGoals: Record<string, number>;
  injection: number;
};

export type ParsedJudgment = {
  model: string;
  answers: Answers;
  usage: { inputTokens: number; outputTokens: number };
};

const probability = z.number().min(0).max(1);

const noulAnswer = z
  .object({ type: z.literal("noul"), noul: probability })
  .transform((answer) => answer.noul);

function choiceAnswer<const K extends string>(keys: readonly [K, ...K[]]) {
  const key = z.enum(keys);
  return z
    .object({ type: z.literal("choice"), choice: key, probabilities: z.record(key, probability) })
    .transform(({ choice, probabilities }) => ({
      choice,
      probability: probabilities[choice],
      probabilities,
    }));
}

const FRUSTRATION_LEVELS = ["0", "1", "2", "3", "4"] as const;

const scoreAnswer = z
  .object({
    type: z.literal("score"),
    score: z
      .number()
      .min(0)
      .max(FRUSTRATION_LEVELS.length - 1),
    probabilities: z.record(z.enum(FRUSTRATION_LEVELS), probability),
  })
  .transform(({ score, probabilities }) => ({
    score,
    probabilities: FRUSTRATION_LEVELS.map((level) => probabilities[level]),
  }));

const fixedAnswers = z.object({
  type: choiceAnswer(TICKET_TYPES),
  area: choiceAnswer(AREAS),
  reach: choiceAnswer(REACHES),
  blocked: noulAnswer,
  workaround: noulAnswer,
  data_exposure: noulAnswer,
  data_loss: noulAnswer,
  regression: noulAnswer,
  frustration: scoreAnswer,
  injection: noulAnswer,
});

const envelope = z.object({
  model: z.string().min(1),
  answers: z.record(z.string(), z.unknown()),
  usage: z.object({ input_tokens: z.number().int(), output_tokens: z.number().int() }),
});

export function parseJudgment(
  response: unknown,
  { candidateMap, nonGoals }: { candidateMap: CandidateMap; nonGoals: readonly NonGoal[] },
): ParsedJudgment {
  const { model, answers, usage } = envelope.parse(response);
  const fixed = fixedAnswers.parse(answers);
  const asked = z
    .object(Object.fromEntries(nonGoals.map(({ id }) => [`${NONGOAL_PREFIX}${id}`, noulAnswer])))
    .parse(answers);

  return {
    model,
    answers: {
      type: fixed.type,
      area: fixed.area,
      reach: fixed.reach,
      blocked: fixed.blocked,
      workaround: fixed.workaround,
      dataExposure: fixed.data_exposure,
      dataLoss: fixed.data_loss,
      regression: fixed.regression,
      frustration: fixed.frustration,
      duplicate: parseDuplicate(answers, candidateMap),
      nonGoals: Object.fromEntries(nonGoals.map(({ id }) => [id, asked[`${NONGOAL_PREFIX}${id}`]])),
      injection: fixed.injection,
    },
    usage: { inputTokens: usage.input_tokens, outputTokens: usage.output_tokens },
  };
}

function parseDuplicate(answers: Record<string, unknown>, candidateMap: CandidateMap) {
  const keys = Object.keys(candidateMap);
  if (keys.length === 0) return null;
  const { duplicate_of } = z
    .object({ duplicate_of: choiceAnswer([NO_DUPLICATE, ...keys]) })
    .parse(answers);
  return { ...duplicate_of, issueId: candidateMap[duplicate_of.choice] ?? null };
}
