import type { Redis } from "ioredis";

import { Worker } from "bullmq";

import { QUEUES } from "@/lib/queues";

import type { WorkerDeps } from "./deps";

import { recomputeProcessor } from "./processors/recompute";
import { spikeProcessor } from "./processors/spike";
import { triageProcessor } from "./processors/triage";

// Starts the three workers on a BullMQ connection (`maxRetriesPerRequest:
// null`) and schedules the spike detector every 5 minutes.

export const SPIKE_SCHEDULER_ID = "spike-detector";
export const SPIKE_EVERY_MS = 5 * 60_000;
/** Jev requests in flight per worker process; the shared token bucket caps the rate across processes. */
export const TRIAGE_CONCURRENCY = 4;

export async function startWorkers(deps: WorkerDeps, connection: Redis) {
  const workers = [
    new Worker(QUEUES.triage, triageProcessor(deps), {
      connection,
      concurrency: TRIAGE_CONCURRENCY,
    }),
    // One at a time, so recomputes never race each other's writes.
    new Worker(QUEUES.recompute, recomputeProcessor(deps), { connection, concurrency: 1 }),
    new Worker(QUEUES.spike, spikeProcessor(deps), { connection, concurrency: 1 }),
  ];
  for (const worker of workers) {
    worker.on("failed", (job, error) =>
      console.error(`${worker.name} ${job?.id ?? "?"} failed: ${error.message}`),
    );
  }
  await deps.queues.spike.upsertJobScheduler(
    SPIKE_SCHEDULER_ID,
    { every: SPIKE_EVERY_MS },
    { name: "spike", data: {} },
  );

  return {
    workers,
    async close() {
      await Promise.all(workers.map((worker) => worker.close()));
    },
  };
}
