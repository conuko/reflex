import type { Fetch } from "@typesafe-ai/sdk";

import {
  APIConnectionError,
  InternalServerError,
  RateLimitError,
  TypeSafeClient,
} from "@typesafe-ai/sdk";

import type { JudgmentProvider } from "./provider";

import { judgeTicket } from "./provider";

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
    judge: (input, options) =>
      judgeTicket("jev", input, async ({ state, questions }) => {
        const { data, requestId } = await client
          .systemOne({ state, questions, model: JEV_MODEL }, { signal: options?.signal })
          .withResponse();
        return { body: data, requestId: requestId ?? null };
      }),
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
