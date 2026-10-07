import { Redis } from "ioredis";

// Redis connections. BullMQ's connections must never give up on a command
// (`maxRetriesPerRequest: null`, or its blocking calls throw); every other
// connection (pub/sub, the rate limiter) fails a command after a few retries
// instead of hanging a request.

export type RedisRole = "bullmq" | "client";

export function createRedis(url: string, role: RedisRole = "client"): Redis {
  return new Redis(url, {
    maxRetriesPerRequest: role === "bullmq" ? null : 3,
    // A deploy may resolve only to IPv6 (see "Later: deploy" in the plan).
    family: 0,
  });
}
