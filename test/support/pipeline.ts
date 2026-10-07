import type { Db } from "@/lib/db";
import type { Judgment } from "@/lib/judgment/provider";
import type { Answers } from "@/lib/triage/parse-judgment";

import { createDb } from "@/lib/db";
import { scriptEnv } from "@/lib/env";
import { ensureFirstPolicy } from "@/lib/policies";
import { createRedis } from "@/lib/redis";
import { applyJudgment, storeJudgment } from "@/lib/triage/run-triage";

// Shared setup for the pipeline's integration tests: the test database and
// Redis db 1 (both set in vitest.config.ts), cleaned before each test.

export function testDb(): Db {
  return createDb(scriptEnv("DATABASE_URL").DATABASE_URL);
}

export function testRedis(role: "bullmq" | "client" = "client") {
  return createRedis(scriptEnv("REDIS_URL").REDIS_URL, role);
}

/** Empties every table; TRUNCATE skips the policy's update trigger. */
export async function resetDatabase(database: Db): Promise<void> {
  await database.$executeRaw`TRUNCATE "Ticket", "Workspace", "Policy", "Incident", "Issue" CASCADE`;
}

export async function createWorkspace(
  database: Db,
  overrides: Partial<{
    id: string;
    tracker: string;
    plan: string;
    seats: number;
    arr: number;
  }> = {},
) {
  return database.workspace.create({
    data: {
      id: "ws-test",
      name: "Test Workspace",
      tracker: "librechat",
      plan: "business",
      seats: 50,
      arr: 15_000,
      ...overrides,
    },
  });
}

export function judgmentFor(answers: Answers, messageCount = 1): Judgment {
  return {
    provider: "fake",
    model: "fake",
    requestId: null,
    questionSetVersion: "v1",
    messageCount,
    state: { ticket: { subject: "", messages: [] } },
    candidateMap: answers.duplicate?.issueId ? { c1: answers.duplicate.issueId } : {},
    answers,
    usage: { inputTokens: 0, outputTokens: 0 },
  };
}

let counter = 0;

/** A ticket with one message, a stored judgment with these answers, and its triage. */
export async function triagedTicket(
  database: Db,
  {
    workspaceId = "ws-test",
    answers,
    createdAt = new Date(),
    source = "intake",
  }: { workspaceId?: string; answers: Answers; createdAt?: Date; source?: string },
) {
  await ensureFirstPolicy(database);
  counter++;
  const ticket = await database.ticket.create({
    data: {
      externalId: `test-${counter}-${Math.random().toString(36).slice(2)}`,
      source,
      workspaceId,
      subject: `Ticket ${counter}`,
      createdAt,
      messages: {
        create: { position: 0, externalId: "m1", from: "customer", text: "Text.", createdAt },
      },
    },
  });
  const judgment = judgmentFor(answers);
  const judgmentId = await storeJudgment(database, ticket.id, judgment, "live");
  const outcome = await applyJudgment(database, {
    ticketId: ticket.id,
    judgmentId,
    answers,
    messageCount: 1,
  });
  return { ticketId: ticket.id, judgmentId, outcome };
}

/** Polls until `check` returns a value, or fails after `timeoutMs`. */
export async function waitFor<T>(
  check: () => Promise<T | undefined | null | false>,
  timeoutMs = 10_000,
): Promise<T> {
  const until = Date.now() + timeoutMs;
  for (;;) {
    // oxlint-disable-next-line eslint/no-await-in-loop
    const value = await check();
    if (value) return value;
    if (Date.now() > until) throw new Error(`Timed out after ${timeoutMs} ms`);
    // oxlint-disable-next-line eslint/no-await-in-loop
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}
