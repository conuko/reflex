import "server-only";
import type { Redis } from "ioredis";

import type { ReflexEvent } from "@/lib/events";

import { webEnv } from "@/lib/env";
import { publishEvent } from "@/lib/events";
import { createRedis } from "@/lib/redis";

// The web process's publisher for live hints: a server action that changes a
// ticket tells every open inbox, including other tabs.

declare global {
  // oxlint-disable-next-line no-var
  var reflexPublisher: Redis | undefined;
}

export async function publish(event: ReflexEvent): Promise<void> {
  const redis = (globalThis.reflexPublisher ??= createRedis(webEnv().REDIS_URL));
  await publishEvent(redis, event);
}
