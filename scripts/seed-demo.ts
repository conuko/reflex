// `pnpm seed:demo`: builds or restores the demo dataset (src/lib/seed-demo.ts)
// and imports the committed eval results for the evaluation screen.
// Judgments come from earlier runs or the committed eval results, so it
// normally makes 0 model calls and needs no key. Only an item with neither is
// judged by the configured provider (JUDGMENT_PROVIDER, `jev` by default).

import type { JudgmentProvider } from "@/lib/judgment/provider";

import { db } from "@/lib/db";
import { scriptEnv } from "@/lib/env";
import { importEvalResults } from "@/lib/eval/import";
import { publishEvent } from "@/lib/events";
import { createFakeProvider } from "@/lib/judgment/fake-provider";
import { createJevClient, createJevProvider } from "@/lib/judgment/jev-provider";
import { createRedis } from "@/lib/redis";
import { seedDemo } from "@/lib/seed-demo";

const providerId = process.env.JUDGMENT_PROVIDER ?? "jev";
if (providerId !== "jev" && providerId !== "fake") {
  console.error(`JUDGMENT_PROVIDER must be one of "jev", "fake", got "${providerId}"`);
  process.exit(1);
}

const database = db();
try {
  const outcome = await seedDemo({
    db: database,
    provider: providerId === "fake" ? createFakeProvider() : lazyJev(),
  });
  const { reused, fromResults, asked } = outcome.judgments;
  console.log(
    `seeded ${outcome.tickets} tickets in ${outcome.workspaces} workspaces, ${outcome.links} duplicate links; judgments: ${reused} reused, ${fromResults} from committed eval results, ${asked} asked`,
  );
  const imported = await importEvalResults(database);
  console.log(`imported ${imported.runs} eval runs with ${imported.items} items`);
  await announce();
} finally {
  await database.$disconnect();
}

// The key is read only if a judgment is actually missing.
function lazyJev(): JudgmentProvider {
  let jev: JudgmentProvider | undefined;
  return {
    id: "jev",
    judge: (input, options) =>
      (jev ??= createJevProvider({
        client: createJevClient({ apiKey: scriptEnv("TYPESAFE_API_KEY").TYPESAFE_API_KEY }),
      })).judge(input, options),
  };
}

// Open inboxes refetch; without Redis the seed still counts as done.
async function announce() {
  const redis = createRedis(scriptEnv("REDIS_URL").REDIS_URL);
  try {
    await publishEvent(redis, { type: "reset" });
  } catch (error) {
    console.warn(
      `could not announce the reset: ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    redis.disconnect();
  }
}
