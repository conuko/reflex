import type { Redis } from "ioredis";

import { Queue } from "bullmq";
import { z } from "zod";

// The worker's queues (plan M4). Payloads are zod-validated on both sides.
// Job ids carry what makes a job unique, so enqueueing the same work twice is
// a no-op: a triage per ticket and message count, a recompute per policy
// version. Ids never contain ":", which BullMQ reserves.

export const QUEUES = { triage: "triage", recompute: "recompute", spike: "spike" } as const;

export const triagePayload = z.object({
  ticketId: z.string().min(1),
  /** The message count the ticket had when the job was queued. */
  messageCount: z.int().min(1),
});

export const recomputePayload = z.discriminatedUnion("reason", [
  /** A new policy version was saved: every ticket. */
  z.object({ reason: z.literal("policy"), policyVersion: z.int().min(1) }),
  /** Demand on an issue changed: the tickets linked to it. */
  z.object({ reason: z.literal("demand"), issueId: z.string().min(1) }),
  /** An incident opened or closed: the tickets of its group. */
  z.object({ reason: z.literal("incident"), ticketIds: z.array(z.string()) }),
]);

export const spikePayload = z.object({});

export type TriagePayload = z.infer<typeof triagePayload>;
export type RecomputePayload = z.infer<typeof recomputePayload>;

export type Queues = {
  triage: Queue;
  recompute: Queue;
  spike: Queue;
  close(): Promise<void>;
};

/** Retryable failures (rate limits, timeouts, 5xx) back off and try again. */
const RETRIES = { attempts: 5, backoff: { type: "exponential", delay: 2_000 } } as const;

export function createQueues(connection: Redis): Queues {
  const options = {
    connection,
    defaultJobOptions: { removeOnComplete: 1_000, removeOnFail: 5_000 },
  };
  const triage = new Queue(QUEUES.triage, options);
  const recompute = new Queue(QUEUES.recompute, options);
  const spike = new Queue(QUEUES.spike, options);
  return {
    triage,
    recompute,
    spike,
    async close() {
      await Promise.all([triage.close(), recompute.close(), spike.close()]);
    },
  };
}

export async function enqueueTriage(queues: Pick<Queues, "triage">, payload: TriagePayload) {
  const { ticketId, messageCount } = triagePayload.parse(payload);
  await queues.triage.add("triage", payload, {
    jobId: `triage-${ticketId}-${messageCount}`,
    ...RETRIES,
  });
}

export async function enqueueRecompute(
  queues: Pick<Queues, "recompute">,
  payload: RecomputePayload,
) {
  const parsed = recomputePayload.parse(payload);
  // A policy version is recomputed once; other recomputes may repeat.
  const jobId = parsed.reason === "policy" ? `recompute-policy-${parsed.policyVersion}` : undefined;
  await queues.recompute.add("recompute", parsed, { ...(jobId && { jobId }), attempts: 3 });
}

/** Spike checks after triages run this long after being asked, so a burst is checked once it has landed. */
export const SPIKE_CHECK_DELAY_MS = 3_000;
const SPIKE_CHECK_BUCKET_MS = 10_000;

/** Checks for spikes shortly, at most once per 10 seconds however often it's asked. */
export async function enqueueSpikeCheck(queues: Pick<Queues, "spike">, now: Date = new Date()) {
  const bucket = Math.floor(now.getTime() / SPIKE_CHECK_BUCKET_MS);
  await queues.spike.add("spike", {}, { jobId: `spike-${bucket}`, delay: SPIKE_CHECK_DELAY_MS });
}
