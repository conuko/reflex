import type { Job } from "bullmq";

import { recomputePayload } from "@/lib/queues";
import { recomputeTriages } from "@/lib/recompute";

import type { WorkerDeps } from "../deps";

// Recomputes triages from stored judgments, with no model calls (ADR-0001):
// every ticket after a policy save, the tickets linked to an issue whose
// demand changed, or the tickets of an incident's group.

export function recomputeProcessor(deps: WorkerDeps) {
  return async (job: Job) => {
    const payload = recomputePayload.parse(job.data);
    const ticketIds =
      payload.reason === "policy"
        ? undefined
        : payload.reason === "incident"
          ? payload.ticketIds
          : (
              await deps.db.ticketIssueLink.findMany({
                where: { issueId: payload.issueId },
                select: { ticketId: true },
              })
            ).map(({ ticketId }) => ticketId);

    const outcome = await recomputeTriages(deps.db, { ticketIds });
    if (payload.reason === "policy") {
      await deps.publish({ type: "policy", version: payload.policyVersion });
    } else {
      for (const { ticketId } of outcome.moved) {
        // oxlint-disable-next-line eslint/no-await-in-loop
        await deps.publish({ type: "ticket", ticketId });
      }
    }
    return { compared: outcome.compared, moved: outcome.moved.length };
  };
}
