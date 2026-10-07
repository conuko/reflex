import { z } from "zod";

import burstJson from "../../data/demo/incident-burst.json" with { type: "json" };

// The hand-written incident burst (plan M4): six customers of one tracker
// reporting the same outage. `pnpm demo:simulate-incident` sends it through
// signed intake; Try it's "Simulate incident" button enqueues it directly.
// Imported rather than read from disk, so the web app's bundle carries it.

const burstFile = z
  .object({
    note: z.string(),
    tickets: z.array(
      z.object({ workspaceId: z.string(), subject: z.string(), text: z.string() }).strict(),
    ),
  })
  .strict();

export type BurstTicket = z.infer<typeof burstFile>["tickets"][number];

export function loadIncidentBurst(): BurstTicket[] {
  return burstFile.parse(burstJson).tickets;
}

/** External ids for one run of the burst, so every run is a new burst. */
export function burstExternalId(run: string, index: number): string {
  return `burst-${run}-${index + 1}`;
}
