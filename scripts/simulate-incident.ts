// `pnpm demo:simulate-incident [--base-url http://localhost:3000]`: sends the
// hand-written burst in data/demo/incident-burst.json through signed intake,
// as an outside system would. With `pnpm worker` running, the tickets are
// triaged, the spike detector opens an incident, and they become Urgent.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";

import { SIGNATURE_HEADER, signBody } from "@/lib/commands/intake";
import { scriptEnv } from "@/lib/env";

const { values } = parseArgs({
  options: { "base-url": { type: "string", default: "http://localhost:3000" } },
  strict: true,
});
const baseUrl = values["base-url"].replace(/\/$/, "");
const { INTAKE_WEBHOOK_SECRET } = scriptEnv("INTAKE_WEBHOOK_SECRET");

const burst = z
  .object({
    note: z.string(),
    tickets: z.array(z.object({ workspaceId: z.string(), subject: z.string(), text: z.string() })),
  })
  .parse(
    JSON.parse(readFileSync(join(import.meta.dirname, "../data/demo/incident-burst.json"), "utf8")),
  );

// A fresh id per run, so every run is a new burst.
const run = Date.now().toString(36);
for (const [index, { workspaceId, subject, text }] of burst.tickets.entries()) {
  const body = JSON.stringify({
    externalId: `burst-${run}-${index + 1}`,
    workspaceId,
    subject,
    message: { id: "m1", from: "customer", text },
  });
  // One after another, like separate customers writing in.
  // oxlint-disable-next-line eslint/no-await-in-loop
  const response = await fetch(`${baseUrl}/api/intake`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      [SIGNATURE_HEADER]: signBody(body, INTAKE_WEBHOOK_SECRET),
    },
    body,
  });
  console.log(`${response.status} ${workspaceId} "${subject}"`);
  if (!response.ok) process.exitCode = 1;
}
