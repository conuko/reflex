import type { Questions } from "@typesafe-ai/sdk";

import type { Answers, Usage } from "@/lib/triage/parse-judgment";
import type { Candidate, CandidateMap } from "@/lib/triage/questions";
import type { TicketInput, TicketState } from "@/lib/triage/state";

import { NON_GOALS } from "@/lib/config/non-goals";
import { parseJudgment } from "@/lib/triage/parse-judgment";
import { buildQuestions, QUESTION_SET_VERSION } from "@/lib/triage/questions";
import { buildState } from "@/lib/triage/state";

// A judgment provider answers the question set for one ticket in one request.
// It sees only the ticket's subject and messages, plus the duplicate
// candidates as options; everything else stays in code (ADR-0001).

export type JudgmentProviderId = "jev" | "fake";

export type JudgmentInput = {
  ticket: TicketInput;
  /** Existing issues offered as possible originals, best match first. */
  candidates: readonly Candidate[];
  /** Eval only: permutes the options and candidates (see `buildQuestions`). */
  shuffleSeed?: number | null;
};

export type Judgment = {
  provider: JudgmentProviderId;
  /** The model that answered, as it reported itself, e.g. `jev-1.13.0`. */
  model: string;
  requestId: string | null;
  questionSetVersion: string;
  /** How many messages the ticket had when it was judged. */
  messageCount: number;
  /** Exactly what the model saw. */
  state: TicketState;
  candidateMap: CandidateMap;
  answers: Answers;
  usage: Usage;
};

export interface JudgmentProvider {
  readonly id: JudgmentProviderId;
  judge(input: JudgmentInput, options?: { signal?: AbortSignal }): Promise<Judgment>;
}

/** The state and questions of one System One request, exactly as built. */
export type SystemOneRequest = { state: TicketState; questions: Questions };

/** Sends one request; returns the response body and its request id. */
export type SendRequest = (
  request: SystemOneRequest,
) => Promise<{ body: unknown; requestId: string | null }>;

// Every provider judges through here, so they all send the same state and
// question text and read the answers the same way; only `send` differs.
export async function judgeTicket(
  provider: JudgmentProviderId,
  { ticket, candidates, shuffleSeed = null }: JudgmentInput,
  send: SendRequest,
): Promise<Judgment> {
  const state = buildState(ticket);
  const { questions, candidateMap } = buildQuestions({
    candidates,
    nonGoals: NON_GOALS,
    shuffleSeed,
  });
  const { body, requestId } = await send({ state, questions });
  const { model, answers, usage } = parseJudgment(body, { candidateMap, nonGoals: NON_GOALS });

  return {
    provider,
    model,
    requestId,
    questionSetVersion: QUESTION_SET_VERSION,
    messageCount: ticket.messages.length,
    state,
    candidateMap,
    answers,
    usage,
  };
}
