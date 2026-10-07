import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { previewPolicy, savePolicy } from "@/lib/commands/policy";
import { createFakeProvider } from "@/lib/judgment/fake-provider";
import { currentPolicy } from "@/lib/policies";
import { DEFAULT_POLICY } from "@/lib/policy-schema";
import { createQueues } from "@/lib/queues";
import { recomputeTriages } from "@/lib/recompute";
import { startWorkers } from "@/worker/start";

import type { AnswerOverrides } from "../support/answers";

import { answers } from "../support/answers";
import {
  createWorkspace,
  resetDatabase,
  testDb,
  testRedis,
  triagedTicket,
  waitFor,
} from "../support/pipeline";

const database = testDb();
const connection = testRedis("bullmq");
const queues = createQueues(connection);

// 500 tickets cycling through shapes the candidate policy treats differently.
const SHAPES: AnswerOverrides[] = [
  {},
  { blocked: 0.9 },
  { reach: "whole_workspace", blocked: 0.9 },
  { type: "question" },
  { type: "feature_request" },
];
const TICKETS = 500;

beforeAll(async () => {
  await connection.flushdb();
  await resetDatabase(database);
  await createWorkspace(database, { id: "ws-enterprise", plan: "enterprise" });
  await createWorkspace(database, { id: "ws-free", plan: "free" });
  for (let i = 0; i < TICKETS; i++) {
    // oxlint-disable-next-line eslint/no-await-in-loop
    await triagedTicket(database, {
      workspaceId: i % 2 === 0 ? "ws-enterprise" : "ws-free",
      answers: answers(SHAPES[i % SHAPES.length]),
      // Spread over the past days: 500 same-area tickets in half an hour would be a real spike.
      createdAt: new Date(Date.now() - (i + 1) * 15 * 60_000),
    });
  }
}, 120_000);

afterAll(async () => {
  await queues.close();
  connection.disconnect();
  await database.$disconnect();
});

describe("policy versions and recompute", () => {
  it("rejects an invalid policy with field-level errors and saves nothing", async () => {
    const values = { ...DEFAULT_POLICY, yesThreshold: 2, reviewBand: { low: 0.8, high: 0.2 } };

    const preview = await previewPolicy(database, values);
    const saved = await savePolicy({ db: database, queues }, values);

    expect(preview).toMatchObject({
      ok: false,
      errors: { yesThreshold: expect.any(Array), "reviewBand.low": expect.any(Array) },
    });
    expect(saved.ok).toBe(false);
    expect((await currentPolicy(database)).version).toBe(1);
  });

  it("saves the next version and recomputes exactly the previewed tickets, with 0 model calls", async () => {
    const candidate = { ...DEFAULT_POLICY, enterpriseRaisesOneLevel: true };
    const preview = await previewPolicy(database, candidate);
    if (!preview.ok) throw new Error("expected a valid policy");
    // Enterprise tickets whose priority can go up: Low and Medium bugs, questions and feature requests.
    expect(preview.preview.movedCount).toBe(200);

    const fake = createFakeProvider();
    const workers = await startWorkers(
      { db: database, provider: fake, queues, publish: async () => {}, now: () => new Date() },
      connection,
    );
    const before = new Map(
      (await database.triage.findMany()).map(({ ticketId, priority }) => [ticketId, priority]),
    );
    const saved = await savePolicy({ db: database, queues }, candidate);
    await waitFor(
      async () => (await database.triage.count({ where: { policyVersion: 2 } })) === TICKETS,
    );
    await workers.close();

    const after = await database.triage.findMany();
    const moved = after.filter(({ ticketId, priority }) => before.get(ticketId) !== priority);
    expect(saved).toEqual({ ok: true, version: 2 });
    expect(moved.map(({ ticketId }) => ticketId).toSorted()).toEqual(
      (await previewMoves(candidate, 1)).toSorted(),
    );
    expect(fake.calls).toBe(0);
  });

  it("never changes a ticket whose priority a person set", async () => {
    const human = await database.triage.findMany({ take: 25, orderBy: { ticketId: "asc" } });
    await database.ticket.updateMany({
      where: { id: { in: human.map(({ ticketId }) => ticketId) } },
      data: { humanPriority: "low" },
    });
    await database.policy.create({
      data: { version: 3, values: { ...DEFAULT_POLICY, yesThreshold: 0.95 } },
    });

    const outcome = await recomputeTriages(database);

    expect(outcome.skippedHumanSet).toBe(25);
    const untouched = await database.triage.findMany({
      where: { ticketId: { in: human.map(({ ticketId }) => ticketId) } },
    });
    expect(untouched.every(({ policyVersion }) => policyVersion === 2)).toBe(true);
  });

  it("keeps saved versions immutable", async () => {
    await expect(
      database.policy.update({ where: { version: 1 }, data: { values: DEFAULT_POLICY } }),
    ).rejects.toThrow("immutable");
  });
});

// The moves a preview from `fromVersion`'s policy would list, recomputed with the
// stored judgments as the preview saw them (the save already moved them).
async function previewMoves(
  candidate: typeof DEFAULT_POLICY,
  fromVersion: number,
): Promise<string[]> {
  const from = await database.policy.findUniqueOrThrow({ where: { version: fromVersion } });
  const { diffPolicies, loadPolicyRows } = await import("@/lib/recompute");
  const { policySchema } = await import("@/lib/policy-schema");
  return diffPolicies(
    await loadPolicyRows(database),
    policySchema.parse(from.values),
    candidate,
  ).moved.map(({ ticketId }) => ticketId);
}
