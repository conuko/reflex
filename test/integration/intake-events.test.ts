import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";

import { handleIntake, signBody } from "@/lib/commands/intake";
import { EVENTS_CHANNEL, openEventStream, publishEvent } from "@/lib/events";
import { createRateLimiter } from "@/lib/judgment/rate-limit";
import { createQueues } from "@/lib/queues";

import { createWorkspace, resetDatabase, testDb, testRedis, waitFor } from "../support/pipeline";

const database = testDb();
const connection = testRedis("bullmq");
const redis = testRedis();
const queues = createQueues(connection);
const secret = "test-intake-webhook-secret-0123456789abcdef";

beforeEach(async () => {
  await connection.flushdb();
  await resetDatabase(database);
  await createWorkspace(database);
});

afterAll(async () => {
  await queues.close();
  connection.disconnect();
  redis.disconnect();
  await database.$disconnect();
});

const payload = (overrides: Record<string, unknown> = {}) =>
  JSON.stringify({
    externalId: "ext-1",
    workspaceId: "ws-test",
    subject: "Export fails",
    message: { id: "m1", text: "The export fails." },
    ...overrides,
  });

const post = (body: string, signature: string | null = signBody(body, secret)) =>
  handleIntake({ db: database, queues, secret }, { body, signature });

const created = z.object({ ticketId: z.string() });

/**
 * How many connections are subscribed to the events channel. Pub/sub ignores
 * the database number, so a running dev server counts too: compare with the
 * count before the test.
 */
async function subscribers(): Promise<number> {
  const reply = await redis.pubsub("NUMSUB", EVENTS_CHANNEL);
  return Array.isArray(reply) ? Number(reply[1]) : 0;
}

describe("intake", () => {
  it("rejects a missing or wrong signature with 401 and stores nothing", async () => {
    const body = payload();

    expect((await post(body, null)).status).toBe(401);
    expect((await post(body, signBody(body, "another-secret-of-thirty-two-chars!!"))).status).toBe(
      401,
    );
    expect((await post(body, signBody(`${body} `, secret))).status).toBe(401);
    expect(await database.ticket.count()).toBe(0);
  });

  it("rejects a body that isn't valid JSON or doesn't fit, and an unknown workspace", async () => {
    expect((await post("{not json")).status).toBe(400);
    expect((await post(payload({ subject: "" }))).status).toBe(400);
    expect((await post(payload({ priority: "urgent" }))).status).toBe(400);
    expect((await post(payload({ workspaceId: "ws-nope" }))).status).toBe(404);
  });

  it("creates a ticket and queues its triage", async () => {
    const result = await post(payload());

    expect(result).toMatchObject({ status: 202, body: { created: true, messageCount: 1 } });
    const { ticketId } = created.parse(result.body);
    expect(await queues.triage.getJob(`triage-${ticketId}-1`)).toBeTruthy();
  });

  it("creates one ticket however often the same delivery arrives", async () => {
    await post(payload());
    const again = await post(payload());

    expect(again.body).toMatchObject({ created: false, messageAdded: false, messageCount: 1 });
    expect(await database.ticket.count()).toBe(1);
    expect(await database.message.count()).toBe(1);
    expect(await queues.triage.count()).toBe(1);
  });

  it("adds a new message to the ticket and queues a re-triage", async () => {
    const first = await post(payload());
    const second = await post(payload({ message: { id: "m2", text: "Still failing." } }));
    const { ticketId } = created.parse(first.body);

    expect(second.body).toMatchObject({
      ticketId,
      created: false,
      messageAdded: true,
      messageCount: 2,
    });
    expect(await queues.triage.getJob(`triage-${ticketId}-2`)).toBeTruthy();
  });
});

describe("the event stream", () => {
  it("streams published events after an open event, and unsubscribes when aborted", async () => {
    const before = await subscribers();
    const controller = new AbortController();
    const stream = openEventStream({
      subscriber: testRedis(),
      signal: controller.signal,
      heartbeatMs: 50,
    });
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let text = "";
    const read = async (until: string) => {
      while (!text.includes(until)) {
        // oxlint-disable-next-line eslint/no-await-in-loop
        const { value, done } = await reader.read();
        if (done) break;
        text += decoder.decode(value);
      }
    };

    await read("event: open");
    await waitFor(async () => (await subscribers()) === before + 1);
    await publishEvent(redis, { type: "ticket", ticketId: "t1" });
    await read('"ticketId":"t1"');
    await read(": heartbeat");
    controller.abort();

    expect(text).toContain('data: {"type":"ticket","ticketId":"t1"}');
    await waitFor(async () => (await subscribers()) === before);
    expect((await reader.read()).done).toBe(true);
  });
});

describe("the event stream, cancelled by its reader", () => {
  it("unsubscribes when the reader goes away before the request is aborted", async () => {
    const before = await subscribers();
    const controller = new AbortController();
    const reader = openEventStream({
      subscriber: testRedis(),
      signal: controller.signal,
    }).getReader();
    await reader.read();
    await waitFor(async () => (await subscribers()) === before + 1);

    await reader.cancel();
    // A late abort after the cancel must not throw on the closed stream.
    controller.abort();

    await expect(waitFor(async () => (await subscribers()) === before)).resolves.toBe(true);
  });
});

describe("the token bucket", () => {
  it("lets requests through up to the request rate, then says how long to wait", async () => {
    const limiter = createRateLimiter(redis, {
      key: "test:requests",
      requestsPerSecond: 2,
      tokensPerSecond: 1e6,
    });

    expect(await limiter.tryAcquire(10)).toBe(0);
    expect(await limiter.tryAcquire(10)).toBe(0);
    const wait = await limiter.tryAcquire(10);
    expect(wait).toBeGreaterThan(0);
    expect(wait).toBeLessThanOrEqual(500);
  });

  it("limits tokens too, and acquire waits until there is room", async () => {
    const limiter = createRateLimiter(redis, {
      key: "test:tokens",
      requestsPerSecond: 100,
      tokensPerSecond: 1_000,
    });

    expect(await limiter.tryAcquire(800)).toBe(0);
    // Measured from the first take: the bucket needs 600 ms to refill 600 tokens,
    // however slowly the test itself runs.
    const taken = Date.now();
    expect(await limiter.tryAcquire(800)).toBeGreaterThan(400);
    await limiter.acquire(800);

    expect(Date.now() - taken).toBeGreaterThanOrEqual(550);
  });

  it("is shared by every limiter on the same key", async () => {
    const a = createRateLimiter(redis, {
      key: "test:shared",
      requestsPerSecond: 1,
      tokensPerSecond: 1e6,
    });
    const b = createRateLimiter(redis, {
      key: "test:shared",
      requestsPerSecond: 1,
      tokensPerSecond: 1e6,
    });

    expect(await a.tryAcquire(1)).toBe(0);
    expect(await b.tryAcquire(1)).toBeGreaterThan(0);
  });
});
