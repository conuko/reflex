// `pnpm eval:import`: loads the committed eval results (eval/results/) into the
// database for the evaluation screen. No model calls; running it again
// replaces the imported rows with the same ones. `pnpm seed:demo` runs it too.

import { db } from "@/lib/db";
import { importEvalResults } from "@/lib/eval/import";

const database = db();
try {
  const { reports, runs, items } = await importEvalResults(database);
  console.log(
    `imported ${runs} eval runs with ${items} items, and the ${reports.join(" and ") || "no"} report${reports.length === 1 ? "" : "s"}`,
  );
} finally {
  await database.$disconnect();
}
