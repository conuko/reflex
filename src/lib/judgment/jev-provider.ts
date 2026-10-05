import type { Fetch } from "@typesafe-ai/sdk";

import {
  APIConnectionError,
  InternalServerError,
  RateLimitError,
  TypeSafeClient,
} from "@typesafe-ai/sdk";

import { NON_GOALS } from "@/lib/config/non-goals";
import { parseJudgment } from "@/lib/triage/parse-judgment";
import { buildQuestions, QUESTION_SET_VERSION } from "@/lib/triage/questions";
import { buildState } from "@/lib/triage/state";

import type { JudgmentProvider } from "./provider";

/** Pinned: changing it takes a reviewed commit and an eval rerun. */
export const JEV_MODEL = "jev-1.13.0";

/** Per attempt. The SDK's default retry stays: 2 retries on 408, 429, 5xx,
 * connection errors and timeouts, honoring Retry-After. */
export const JEV_TIMEOUT_MS = 20_000;

export function createJevClient({ apiKey, fetch }: { apiKey: string; fetch?: Fetch }) {
  return new TypeSafeClient({ apiKey, timeout: JEV_TIMEOUT_MS, ...(fetch && { fetch }) });
}

export function createJevProvider({ client }: { client: TypeSafeClient }): JudgmentProvider {
  return {
    id: "jev",
    async judge({ ticket, candidates }, options) {
      const state = buildState(ticket);
      const { questions, candidateMap } = buildQuestions({ candidates, nonGoals: NON_GOALS });
      const { data, requestId } = await client
        .systemOne({ state, questions, model: JEV_MODEL }, { signal: options?.signal })
        .withResponse();
      const { model, answers, usage } = parseJudgment(data, {
        candidateMap,
        nonGoals: NON_GOALS,
      });

      return {
        provider: "jev",
        model,
        requestId: requestId ?? null,
        questionSetVersion: QUESTION_SET_VERSION,
        messageCount: ticket.messages.length,
        state,
        candidateMap,
        answers,
        usage,
      };
    },
  };
}

// Rate limits, connection failures (timeouts included) and 5xx errors are worth
// retrying once the SDK's own retries are spent. Every other error, such as a
// 4xx, a bad config or a response that doesn't fit the question set, would
// fail the same way again.
export function isRetryableJevError(error: unknown): boolean {
  return (
    error instanceof RateLimitError ||
    error instanceof InternalServerError ||
    error instanceof APIConnectionError
  );
}
