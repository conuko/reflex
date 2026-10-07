// `pnpm worker`: the only process besides the CLI scripts that calls a
// judgment provider (plan M4). The web process only queues jobs and reads
// results, and never reads the model key.

import { db } from "@/lib/db";
import { workerEnv } from "@/lib/env";
import { publishEvent } from "@/lib/events";
import { createFakeProvider } from "@/lib/judgment/fake-provider";
import { createJevClient, createJevProvider } from "@/lib/judgment/jev-provider";
import { createRateLimiter, rateLimited } from "@/lib/judgment/rate-limit";
import { createQueues } from "@/lib/queues";
import { createRedis } from "@/lib/redis";

import { startWorkers } from "./start";

const env = workerEnv();
const connection = createRedis(env.REDIS_URL, "bullmq");
const client = createRedis(env.REDIS_URL);
const queues = createQueues(connection);
const provider =
  env.JUDGMENT_PROVIDER === "jev"
    ? rateLimited(
        createJevProvider({ client: createJevClient({ apiKey: env.TYPESAFE_API_KEY }) }),
        createRateLimiter(client),
      )
    : createFakeProvider();
const database = db();

const running = await startWorkers(
  {
    db: database,
    provider,
    queues,
    publish: (event) => publishEvent(client, event),
    now: () => new Date(),
  },
  connection,
);
console.log(`worker started: provider ${provider.id}`);

const stop = async () => {
  console.log("worker stopping");
  await running.close();
  await queues.close();
  client.disconnect();
  connection.disconnect();
  await database.$disconnect();
  process.exit(0);
};
process.once("SIGINT", () => void stop());
process.once("SIGTERM", () => void stop());
