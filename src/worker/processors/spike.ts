import { runSpikeCheck } from "@/lib/incidents";
import { recomputeTriages } from "@/lib/recompute";

import type { WorkerDeps } from "../deps";

// Opens and closes incidents, then recomputes the affected tickets so they
// become Urgent while their incident is open and return to normal after.

export function spikeProcessor(deps: WorkerDeps) {
  return async () => {
    const check = await runSpikeCheck(deps.db, { now: deps.now() });
    for (const incident of [...check.opened, ...check.closed]) {
      // oxlint-disable-next-line eslint/no-await-in-loop
      const outcome = await recomputeTriages(deps.db, { ticketIds: incident.ticketIds });
      // oxlint-disable-next-line eslint/no-await-in-loop
      await deps.publish({ type: "incident", incidentId: incident.incidentId });
      for (const { ticketId } of outcome.moved) {
        // oxlint-disable-next-line eslint/no-await-in-loop
        await deps.publish({ type: "ticket", ticketId });
      }
    }
    return { opened: check.opened.length, closed: check.closed.length };
  };
}
