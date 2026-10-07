import "server-only";
import type { Queues } from "@/lib/queues";

import { webEnv } from "@/lib/env";
import { createQueues } from "@/lib/queues";
import { createRedis } from "@/lib/redis";

// The web process's queues, one set per process (kept on globalThis so dev
// reloads don't open new connections). The web only adds jobs; the worker
// runs them.

declare global {
  // oxlint-disable-next-line no-var
  var reflexQueues: Queues | undefined;
}

export function queues(): Queues {
  return (globalThis.reflexQueues ??= createQueues(createRedis(webEnv().REDIS_URL, "bullmq")));
}
