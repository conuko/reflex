import type { Redis } from "ioredis";

import type { JudgmentInput, JudgmentProvider } from "./provider";

// A Redis token bucket on both requests and tokens, shared by every worker
// process (plan M4), so Reflex stays under Jev's limits however many workers
// run. One Lua script refills both buckets from the time elapsed and takes
// from them only if both have enough, atomically; otherwise it says how long
// to wait.

/** Jev's documented limits; the docs say they are "adjusting dynamically". */
export const JEV_RATE_LIMITS = {
  requestsPerSecond: 80,
  tokensPerSecond: 100_000,
  source: "https://docs.typesafe.ai/models",
  retrieved: "2026-10-05",
} as const;

/** The question set's own input tokens, on top of the ticket and candidates (measured: about 3,900 with none). */
const QUESTION_SET_TOKENS = 3_500;
const BYTES_PER_TOKEN = 3;

// Buckets hold at most one second's worth, so a burst can't exceed the limit.
const TAKE = `
local now_parts = redis.call('TIME')
local now = tonumber(now_parts[1]) * 1000 + math.floor(tonumber(now_parts[2]) / 1000)
local function level(key, rate)
  local stored = redis.call('HMGET', key, 'level', 'at')
  local value = tonumber(stored[1]) or rate
  local at = tonumber(stored[2]) or now
  return math.min(rate, value + (now - at) * rate / 1000)
end
local request_rate, token_rate = tonumber(ARGV[1]), tonumber(ARGV[2])
local requests, tokens = level(KEYS[1], request_rate), level(KEYS[2], token_rate)
local token_cost = math.min(tonumber(ARGV[3]), token_rate)
if requests >= 1 and tokens >= token_cost then
  redis.call('HSET', KEYS[1], 'level', requests - 1, 'at', now)
  redis.call('HSET', KEYS[2], 'level', tokens - token_cost, 'at', now)
  redis.call('PEXPIRE', KEYS[1], 60000)
  redis.call('PEXPIRE', KEYS[2], 60000)
  return 0
end
local wait_requests = requests >= 1 and 0 or math.ceil((1 - requests) * 1000 / request_rate)
local wait_tokens = tokens >= token_cost and 0 or math.ceil((token_cost - tokens) * 1000 / token_rate)
return math.max(wait_requests, wait_tokens, 1)
`;

export type RateLimiter = {
  /** Resolves once one request of about `tokens` input tokens may be sent. */
  acquire(tokens: number, signal?: AbortSignal): Promise<void>;
  /** Takes capacity if there is enough now; returns how many ms to wait otherwise (0 when taken). */
  tryAcquire(tokens: number): Promise<number>;
};

export function createRateLimiter(
  redis: Redis,
  {
    key = "reflex:rate-limit:jev",
    requestsPerSecond = JEV_RATE_LIMITS.requestsPerSecond,
    tokensPerSecond = JEV_RATE_LIMITS.tokensPerSecond,
  }: { key?: string; requestsPerSecond?: number; tokensPerSecond?: number } = {},
): RateLimiter {
  const tryAcquire = async (tokens: number) =>
    Number(
      await redis.eval(
        TAKE,
        2,
        `${key}:requests`,
        `${key}:tokens`,
        requestsPerSecond,
        tokensPerSecond,
        Math.ceil(tokens),
      ),
    );

  return {
    tryAcquire,
    async acquire(tokens, signal) {
      // Polls until both buckets have room; each wait is as long as the script says.
      for (;;) {
        // oxlint-disable-next-line eslint/no-await-in-loop
        const wait = await tryAcquire(tokens);
        if (wait === 0) return;
        signal?.throwIfAborted();
        // oxlint-disable-next-line eslint/no-await-in-loop
        await new Promise((resolve) => setTimeout(resolve, wait));
      }
    },
  };
}

/** About how many input tokens a request for this input will use. */
export function estimateTokens({ ticket, candidates }: JudgmentInput): number {
  return (
    Math.ceil(JSON.stringify({ ticket, candidates }).length / BYTES_PER_TOKEN) + QUESTION_SET_TOKENS
  );
}

/** A provider that waits for the shared bucket before every request. */
export function rateLimited(provider: JudgmentProvider, limiter: RateLimiter): JudgmentProvider {
  return {
    id: provider.id,
    async judge(input, options) {
      await limiter.acquire(estimateTokens(input), options?.signal);
      return provider.judge(input, options);
    },
  };
}
