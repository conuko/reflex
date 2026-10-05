import type { Answers } from "@/lib/triage/parse-judgment";
import type { Candidate, CandidateMap } from "@/lib/triage/questions";
import type { TicketInput, TicketState } from "@/lib/triage/state";

// A judgment provider answers the question set for one ticket in one request.
// It sees only the ticket's subject and messages, plus the duplicate
// candidates as options; everything else stays in code (ADR-0001).

export type JudgmentInput = {
  ticket: TicketInput;
  /** Existing issues offered as possible originals, best match first. */
  candidates: readonly Candidate[];
};

export type Judgment = {
  /** The judgment provider's id, e.g. `jev`. */
  provider: string;
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
  usage: { inputTokens: number; outputTokens: number };
};

export interface JudgmentProvider {
  readonly id: string;
  judge(input: JudgmentInput, options?: { signal?: AbortSignal }): Promise<Judgment>;
}
