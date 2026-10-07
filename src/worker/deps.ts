import type { Db } from "@/lib/db";
import type { ReflexEvent } from "@/lib/events";
import type { JudgmentProvider } from "@/lib/judgment/provider";
import type { Queues } from "@/lib/queues";

/** What the processors need; tests pass a fake provider and the test database and Redis. */
export type WorkerDeps = {
  db: Db;
  provider: JudgmentProvider;
  queues: Queues;
  publish: (event: ReflexEvent) => Promise<void>;
  now: () => Date;
};
