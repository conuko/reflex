import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";

import type { Db } from "@/lib/db";

import { issueDemand } from "@/lib/demand";
import { loadEvalItems } from "@/lib/eval/sets";
import { runSpikeCheck } from "@/lib/incidents";
import { createFakeProvider } from "@/lib/judgment/fake-provider";
import { DEFAULT_POLICY } from "@/lib/policy-schema";
import { recomputeTriages } from "@/lib/recompute";
import { loadWorkspaces, seedDemo, seedTime, workspaceFor } from "@/lib/seed-demo";
import { SPIKE_RULES } from "@/lib/spike";

import { answers } from "../support/answers";
import { createWorkspace, resetDatabase, testDb, triagedTicket } from "../support/pipeline";

const database = testDb();
const now = new Date("2026-10-06T12:00:00Z");
const dirs: string[] = [];

afterAll(async () => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  await database.$disconnect();
});

// Everything a person sees about the demo, minus generated ids.
async function seedState(db: Db) {
  const tickets = await db.ticket.findMany({
    orderBy: { externalId: "asc" },
    include: { messages: { orderBy: { position: "asc" } }, triage: true, links: true },
  });
  return {
    tickets: tickets.map((ticket) => ({
      externalId: ticket.externalId,
      source: ticket.source,
      workspaceId: ticket.workspaceId,
      createdAt: ticket.createdAt.toISOString(),
      humanPriority: ticket.humanPriority,
      messages: ticket.messages.map(({ from, text, createdAt }) => [
        from,
        text,
        createdAt.toISOString(),
      ]),
      triage: ticket.triage && {
        priority: ticket.triage.priority,
        ruleFired: ticket.triage.ruleFired,
        needsReview: ticket.triage.needsReview,
        policyVersion: ticket.triage.policyVersion,
      },
      links: ticket.links.map(({ issueId, origin }) => `${origin}:${issueId}`),
    })),
    policies: await db.policy.count(),
    incidents: await db.incident.count(),
    corrections: await db.correction.count(),
    issues: await db.issue.count(),
  };
}

describe("seedDemo", () => {
  beforeEach(async () => {
    await resetDatabase(database);
  });

  it("seeds every eval item from the committed results with 0 model calls, and restores exactly", async () => {
    const fake = createFakeProvider();
    const first = await seedDemo({ db: database, provider: fake, now });
    const seeded = await seedState(database);

    // A demo session: an intake ticket, a person's priority, a correction, a policy, an incident, an issue.
    const [someTicket] = seeded.tickets;
    const ticket = await database.ticket.findUniqueOrThrow({
      where: { externalId: someTicket?.externalId ?? "" },
    });
    await database.ticket.update({ where: { id: ticket.id }, data: { humanPriority: "urgent" } });
    await database.correction.create({
      data: { ticketId: ticket.id, field: "priority", fromValue: "low", toValue: "urgent" },
    });
    await database.ticket.create({
      data: {
        externalId: "intake-1",
        source: "intake",
        workspaceId: "ws-01",
        subject: "New",
        createdAt: now,
      },
    });
    await database.policy.create({
      data: { version: 2, values: { ...DEFAULT_POLICY, enterpriseRaisesOneLevel: true } },
    });
    await database.incident.create({
      data: { groupKey: "area:librechat:chat", windowStart: now, ticketCount: 5 },
    });
    await database.issue.create({
      data: {
        id: "librechat#9999",
        tracker: "librechat",
        number: 9999,
        source: "app",
        title: "New",
        body: "New",
        createdAt: now,
      },
    });

    const second = await seedDemo({ db: database, provider: fake, now });

    expect(first.judgments).toEqual({ reused: 0, fromResults: 180, asked: 0 });
    expect(second.judgments).toEqual({ reused: 180, fromResults: 0, asked: 0 });
    expect(fake.calls).toBe(0);
    expect(await seedState(database)).toEqual(seeded);
    expect(seeded).toMatchObject({ policies: 1, incidents: 0, corrections: 0, issues: 80 });
    expect(seeded.tickets).toHaveLength(180);
  }, 120_000);

  it("asks the provider only for items without a judgment, once", async () => {
    const empty = mkdtempSync(join(tmpdir(), "reflex-no-results-"));
    dirs.push(empty);
    const items = loadEvalItems()
      .filter(({ set }) => set === "support")
      .slice(0, 5);
    const fake = createFakeProvider();

    const first = await seedDemo({ db: database, provider: fake, now, items, resultsDir: empty });
    const second = await seedDemo({ db: database, provider: fake, now, items, resultsDir: empty });

    expect(first.judgments.asked).toBe(5);
    expect(second.judgments).toEqual({ reused: 5, fromResults: 0, asked: 0 });
    expect(fake.calls).toBe(5);
  });

  it("places each item the same way relative to the run date", () => {
    const items = loadEvalItems();
    const workspaces = loadWorkspaces();
    const later = new Date(now.getTime() + 3 * 86_400_000);

    for (const item of items) {
      expect(workspaceFor(item, workspaces).tracker).toBe(item.tracker);
      expect(later.getTime() - seedTime(item.id, later).getTime()).toBe(
        now.getTime() - seedTime(item.id, now).getTime(),
      );
      expect(now.getTime() - seedTime(item.id, now).getTime()).toBeLessThan(14 * 86_400_000);
    }
  });
});

describe("spikes", () => {
  beforeEach(async () => {
    await resetDatabase(database);
    await createWorkspace(database);
  });

  it("opens an incident for a burst, makes its tickets Urgent with the spike rule, and only once", async () => {
    const outage = answers({ type: "bug", area: "agents" });
    const burst = [];
    for (let i = 0; i < SPIKE_RULES.minTickets; i++) {
      burst.push(
        // oxlint-disable-next-line eslint/no-await-in-loop
        await triagedTicket(database, {
          answers: outage,
          createdAt: new Date(now.getTime() - i * 60_000),
        }),
      );
    }
    const quiet = await triagedTicket(database, {
      answers: answers({ area: "chat" }),
      createdAt: now,
    });

    const check = await runSpikeCheck(database, { now });
    await recomputeTriages(database, {
      ticketIds: check.opened.flatMap(({ ticketIds }) => ticketIds),
    });
    const again = await runSpikeCheck(database, { now: new Date(now.getTime() + 5 * 60_000) });

    expect(check.opened).toHaveLength(1);
    expect(check.opened[0]).toMatchObject({ groupKey: "area:librechat:agents" });
    expect(again.opened).toEqual([]);
    expect(await database.incident.count()).toBe(1);
    const triages = await database.triage.findMany({
      where: { ticketId: { in: burst.map(({ ticketId }) => ticketId) } },
    });
    expect(
      triages.every(({ priority, ruleFired }) => priority === "urgent" && ruleFired === "spike"),
    ).toBe(true);
    expect(
      (await database.triage.findUniqueOrThrow({ where: { ticketId: quiet.ticketId } })).ruleFired,
    ).toBe("bug");
    const trace = z
      .array(z.object({ rule: z.string(), matched: z.boolean() }))
      .parse(triages[0]?.trace);
    const spikeStep = trace.find(({ rule }) => rule === "spike");
    expect(spikeStep?.matched).toBe(true);
  });

  it("closes the incident once the burst is over, and the tickets return to normal", async () => {
    const outage = answers({ type: "bug", area: "agents" });
    for (let i = 0; i < SPIKE_RULES.minTickets; i++) {
      // oxlint-disable-next-line eslint/no-await-in-loop
      await triagedTicket(database, {
        answers: outage,
        createdAt: new Date(now.getTime() - i * 60_000),
      });
    }
    const opened = await runSpikeCheck(database, { now });
    await recomputeTriages(database, {
      ticketIds: opened.opened.flatMap(({ ticketIds }) => ticketIds),
    });

    const closed = await runSpikeCheck(database, {
      now: new Date(now.getTime() + 2 * SPIKE_RULES.windowMinutes * 60_000),
    });
    await recomputeTriages(database, {
      ticketIds: closed.closed.flatMap(({ ticketIds }) => ticketIds),
    });

    expect(closed.closed).toHaveLength(1);
    expect(await database.triage.count({ where: { ruleFired: "spike" } })).toBe(0);
  });
});

// A feature-request ticket of the workspace, linked by a person to librechat#1.
async function linked(workspaceId: string, createdAt = now) {
  const { ticketId } = await triagedTicket(database, {
    workspaceId,
    createdAt,
    answers: answers({ type: "feature_request" }),
  });
  await database.ticketIssueLink.create({
    data: { ticketId, issueId: "librechat#1", origin: "human" },
  });
}

describe("demand", () => {
  beforeEach(async () => {
    await resetDatabase(database);
    await database.issue.create({
      data: {
        id: "librechat#1",
        tracker: "librechat",
        number: 1,
        title: "Export to PDF",
        body: "Please.",
        createdAt: now,
      },
    });
    await createWorkspace(database, { id: "ws-a", plan: "enterprise", arr: 400_000 });
    await createWorkspace(database, { id: "ws-b", plan: "business", arr: 30_000 });
    await createWorkspace(database, { id: "ws-c", plan: "free", arr: 0 });
  });

  it("counts each workspace's ARR once, however many of its tickets are linked", async () => {
    await linked("ws-a");
    await linked("ws-a");
    await linked("ws-a");
    await linked("ws-b");

    const [demand] = await issueDemand(database, { now });

    expect(demand).toMatchObject({
      issueId: "librechat#1",
      tickets: 4,
      workspaces: 2,
      arr: 430_000,
      plans: { free: 0, business: 1, enterprise: 1 },
    });
  });

  it("matches a hand-written SQL query", async () => {
    await linked("ws-a");
    await linked("ws-b");
    await linked("ws-c");
    await linked("ws-c");

    const [demand] = await issueDemand(database, { now });
    const [expected] = await database.$queryRaw<
      { tickets: bigint; workspaces: bigint; arr: bigint }[]
    >`
      SELECT
        (SELECT count(*) FROM "TicketIssueLink" WHERE "issueId" = 'librechat#1') AS tickets,
        (SELECT count(DISTINCT t."workspaceId") FROM "TicketIssueLink" l JOIN "Ticket" t ON t."id" = l."ticketId") AS workspaces,
        (SELECT sum("arr") FROM "Workspace" WHERE "id" IN (
          SELECT t."workspaceId" FROM "TicketIssueLink" l JOIN "Ticket" t ON t."id" = l."ticketId")) AS arr
    `;

    expect(demand).toMatchObject({
      tickets: Number(expected?.tickets),
      workspaces: Number(expected?.workspaces),
      arr: Number(expected?.arr),
    });
  });

  it("counts linked tickets per day over the last 14 days", async () => {
    await linked("ws-a", new Date(now.getTime() - 30 * 60_000));
    await linked("ws-b", new Date(now.getTime() - 30 * 60_000));
    await linked("ws-c", new Date(now.getTime() - 13.5 * 86_400_000));
    await linked("ws-c", new Date(now.getTime() - 20 * 86_400_000));

    const [demand] = await issueDemand(database, { now });

    expect(demand?.trend).toHaveLength(14);
    expect(demand?.trend.at(-1)).toBe(2);
    expect(demand?.trend[0]).toBe(1);
    expect(demand?.trend.reduce((a, b) => a + b, 0)).toBe(3);
  });

  it("gives a feature request the demand of the issue it's linked to", async () => {
    await linked("ws-a");
    await linked("ws-b");
    const { ticketId } = await triagedTicket(database, {
      workspaceId: "ws-c",
      answers: answers({ type: "feature_request" }),
    });
    await database.ticketIssueLink.create({
      data: { ticketId, issueId: "librechat#1", origin: "human" },
    });

    await recomputeTriages(database, { ticketIds: [ticketId] });

    // 3 workspaces and $430k ARR: the medium threshold (3 workspaces), not the high one (8, or $500k).
    expect((await database.triage.findUniqueOrThrow({ where: { ticketId } })).ruleFired).toBe(
      "feature_demand_medium",
    );
  });
});
