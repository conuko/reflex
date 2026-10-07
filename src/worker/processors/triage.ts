import type { Job } from "bullmq";

import { UnrecoverableError } from "bullmq";

import { isUnrecoverableError } from "@/lib/judgment/jev-provider";
import { enqueueRecompute, enqueueSpikeCheck, triagePayload } from "@/lib/queues";
import { triageTicket } from "@/lib/triage/run-triage";

import type { WorkerDeps } from "../deps";

// Triages one ticket. Retryable failures (rate limits, timeouts, 5xx, a
// database hiccup) throw as they are, so BullMQ backs off and tries again;
// failures that would repeat become UnrecoverableError and fail the job now.

export function triageProcessor(deps: WorkerDeps) {
  return async (job: Job) => {
    const payload = triagePayload.parse(job.data);
    let outcome;
    try {
      outcome = await triageTicket(deps, payload);
    } catch (error) {
      throw classify(error);
    }

    if (outcome.status === "triaged") {
      await deps.publish({ type: "ticket", ticketId: outcome.ticketId });
      for (const issueId of outcome.changedIssueIds) {
        // oxlint-disable-next-line eslint/no-await-in-loop
        await enqueueRecompute(deps.queues, { reason: "demand", issueId });
      }
      await enqueueSpikeCheck(deps.queues);
    }
    return outcome.status;
  };
}

export function classify(error: unknown): unknown {
  if (!isUnrecoverableError(error)) return error;
  return new UnrecoverableError(error instanceof Error ? error.message : String(error));
}
