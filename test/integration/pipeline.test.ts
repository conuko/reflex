import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { FakeProvider } from "@/lib/judgment/fake-provider";

import { receiveIntake } from "@/lib/commands/intake";
import { importIssueCorpus } from "@/lib/issues";
import { createFakeProvider } from "@/lib/judgment/fake-provider";
import { currentPolicy } from "@/lib/policies";
import { triage } from "@/lib/policy";
import { createQueues } from "@/lib/queues";
import { loadContexts, storedAnswers } from "@/lib/triage/context";
import { applyJudgment, storeJudgment, triageTicket, writeTriage } from "@/lib/triage/run-triage";
import { startWorkers } from "@/worker/start";

import { answers } from "../support/answers";
import {
  createWorkspace,
  judgmentFor,
  resetDatabase,
  testDb,
  testRedis,
  waitFor,
} from "../support/pipeline";

const database = testDb();
const connection = testRedis("bullmq");
const queues = createQueues(connection);
let fake: FakeProvider;
let workers: Awaited<ReturnType<typeof startWorkers>> | undefined;
const published: unknown[] = [];

beforeAll(async () => {
  await resetDatabase(database);
  await importIssueCorpus(database);
});

beforeEach(async () => {
  await workers?.close();
  await connection.flushdb();
  await database.$executeRaw`TRUNCATE "Ticket", "Workspace", "Policy", "Incident" CASCADE`;
  await createWorkspace(database);
  fake = createFakeProvider();
  published.length = 0;
  workers = await startWorkers(
    {
      db: database,
      provider: fake,
      queues,
      publish: async (event) => {
        published.push(event);
      },
      now: () => new Date(),
    },
    connection,
  );
});

afterAll(async () => {
  await workers?.close();
  await queues.close();
  connection.disconnect();
  await database.$disconnect();
});

const intake = (externalId: string, messageId: string, text: string) =>
  receiveIntake(
    { db: database, queues },
    {
      externalId,
      workspaceId: "ws-test",
      subject: "Okta SSO loop",
      message: { id: messageId, text },
    },
  );

describe("the triage pipeline", () => {
  it("triages a ticket from intake: one judgment, one triage with the policy's priority and trace", async () => {
    const { ticketId } = await intake("ext-1", "m1", "Everyone is stuck in an Okta redirect loop.");

    const stored = await waitFor(() =>
      database.triage.findUnique({ where: { ticketId }, include: { judgment: true } }),
    );

    expect(fake.calls).toBe(1);
    expect(await database.judgment.count({ where: { ticketId } })).toBe(1);
    // The stored triage is exactly what the policy makes of the stored answers.
    const ticket = await database.ticket.findUniqueOrThrow({
      where: { id: ticketId },
      include: { workspace: true, links: true },
    });
    const parsed = storedAnswers.parse(stored.judgment.answers);
    const context = (
      await loadContexts(database, [
        {
          id: ticketId,
          createdAt: ticket.createdAt,
          plan: ticket.workspace.plan,
          tracker: ticket.workspace.tracker,
          answers: parsed,
          linkedIssueIds: ticket.links.map(({ issueId }) => issueId),
        },
      ])
    ).get(ticketId);
    if (!context) throw new Error("no context for the ticket");
    const expected = triage(parsed, context, (await currentPolicy(database)).values);
    expect(stored).toMatchObject({
      priority: expected.priority,
      ruleFired: expected.ruleFired,
      messageCount: 1,
      policyVersion: 1,
    });
    expect(stored.trace).toEqual(expected.trace);
    expect(published).toContainEqual({ type: "ticket", ticketId });
  });

  it("re-triages when a new message arrives, with a second judgment", async () => {
    const { ticketId } = await intake("ext-2", "m1", "Okta logins loop.");
    await waitFor(() => database.triage.findUnique({ where: { ticketId } }));

    await intake("ext-2", "m2", "Still looping after clearing cookies.");

    const updated = await waitFor(() =>
      database.triage.findFirst({ where: { ticketId, messageCount: 2 } }),
    );
    expect(updated.messageCount).toBe(2);
    expect(await database.judgment.count({ where: { ticketId } })).toBe(2);
    expect(fake.calls).toBe(2);
  });
});

describe("the stale-judgment guard", () => {
  it("never lets a judgment of fewer messages overwrite a newer triage", async () => {
    await workers?.close();
    workers = undefined;
    const { ticketId } = await intake("ext-3", "m1", "First message.");
    await intake("ext-3", "m2", "Second message.");
    const policy = await currentPolicy(database);
    const newer = judgmentFor(answers({ type: "bug", blocked: 0.9 }), 2);
    const older = judgmentFor(answers({ type: "question" }), 1);
    const newerId = await storeJudgment(database, ticketId, newer, "live");
    const olderId = await storeJudgment(database, ticketId, older, "live");

    await applyJudgment(database, {
      ticketId,
      judgmentId: newerId,
      answers: newer.answers,
      messageCount: 2,
    });
    const late = await applyJudgment(database, {
      ticketId,
      judgmentId: olderId,
      answers: older.answers,
      messageCount: 1,
    });
    const direct = await writeTriage(database, {
      ticketId,
      judgmentId: olderId,
      messageCount: 1,
      policyVersion: policy.version,
      result: triage(
        older.answers,
        { plan: "free", spikeActive: false, demand: { workspaces: 0, arr: 0 } },
        policy.values,
      ),
    });

    expect(late.status).toBe("stale");
    expect(direct).toBe(false);
    expect(await database.triage.findUniqueOrThrow({ where: { ticketId } })).toMatchObject({
      judgmentId: newerId,
      messageCount: 2,
    });
  });

  it("skips a job whose ticket has gained messages since it was queued", async () => {
    await workers?.close();
    workers = undefined;
    const { ticketId } = await intake("ext-4", "m1", "First.");
    await intake("ext-4", "m2", "Second.");

    const outcome = await triageTicket(
      { db: database, provider: fake },
      { ticketId, messageCount: 1 },
    );

    expect(outcome.status).toBe("superseded");
    expect(fake.calls).toBe(0);
  });
});
