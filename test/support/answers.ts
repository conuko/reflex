import type { Answers, ChoiceAnswer } from "@/lib/triage/parse-judgment";
import type { Area, Reach, TicketType } from "@/lib/triage/questions";

import { AREAS, REACHES, TICKET_TYPES } from "@/lib/triage/questions";

// Builds the answers of a judgment for policy tests: a confident bug in chat
// that affects one user, with every yes/no answer a clear no, unless overridden.

function choice<K extends string>(
  labels: readonly K[],
  chosen: K,
  probability = 0.9,
): ChoiceAnswer<K> {
  const rest = (1 - probability) / (labels.length - 1);
  // Built from `labels`, so it has exactly one entry per label.
  /* oxlint-disable typescript/no-unsafe-type-assertion */
  const probabilities = Object.fromEntries(
    labels.map((label) => [label, label === chosen ? probability : rest]),
  ) as Record<K, number>;
  /* oxlint-enable typescript/no-unsafe-type-assertion */
  return { choice: chosen, probability, probabilities };
}

export type AnswerOverrides = Partial<Omit<Answers, "type" | "area" | "reach">> & {
  type?: TicketType | [TicketType, number];
  area?: Area | [Area, number];
  reach?: Reach;
};

export function answers(overrides: AnswerOverrides = {}): Answers {
  const { type = "bug", area = "chat", reach = "one_user", ...rest } = overrides;
  const [typeChoice, typeProbability] = Array.isArray(type) ? type : [type, 0.9];
  const [areaChoice, areaProbability] = Array.isArray(area) ? area : [area, 0.9];
  return {
    type: choice(TICKET_TYPES, typeChoice, typeProbability),
    area: choice(AREAS, areaChoice, areaProbability),
    reach: choice(REACHES, reach),
    blocked: 0.05,
    workaround: 0.05,
    dataExposure: 0.05,
    dataLoss: 0.05,
    regression: 0.05,
    frustration: { score: 0, probabilities: [1, 0, 0, 0, 0] },
    duplicate: null,
    nonGoals: { self_hosting: 0.05, native_mobile_apps: 0.05, media_generation: 0.05 },
    injection: 0.05,
    ...rest,
  };
}
