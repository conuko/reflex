import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { receiveIntake } from "@/lib/commands/intake";
import {
  acceptTriage,
  createIssue,
  linkIssue,
  setPriority,
  setPriorityInput,
  unlinkIssue,
} from "@/lib/commands/tickets";
import { addTryItReply, simulateIncident, submitTryIt } from "@/lib/commands/try-it";
import { TRY_IT_MAX_CHARS } from "@/lib/config/try-it";
import { loadIncidentBurst } from "@/lib/demo";
import { createFakeProvider } from "@/lib/judgment/fake-provider";
import { DEFAULT_POLICY } from "@/lib/policy-schema";
import { createQueues } from "@/lib/queues";
import { recomputeTriages } from "@/lib/recompute";
import { seedDemo } from "@/lib/seed-demo";
import { findCandidates } from "@/lib/triage/candidates";

import { answers } from "../support/answers";
import {
  createWorkspace,
  resetDatabase,
  testDb,
  testRedis,
  triagedTicket,
} from "../support/pipeline";

// The commands behind the app's server actions (plan M5), on the test
// database and Redis db 1. Each queues work for the worker; the tests check
// what was stored and what was queued, without running the worker.

const database = testDb();
const connection = testRedis("bullmq");
const queues = createQueues(connection);
const deps = { db: database, queues };
const now = new Date("2026-10-07T09:00:00Z");

beforeEach(async () => {
  await connection.flushdb();
  await resetDatabase(database);
  await createWorkspace(database);
  await database.issue.createMany({
    data: [
      {
        id: "librechat#10",
        tracker: "librechat",
        number: 10,
        title: "Export to PDF",
        body: "Please.",
        createdAt: now,
      },
      {
        id: "librechat#11",
        tracker: "librechat",
        number: 11,
        title: "Okta loop",
        body: "Loops.",
        createdAt: now,
      },
      {
        id: "lobehub#5",
        tracker: "lobehub",
        number: 5,
        title: "Dark mode",
        body: "Dark.",
        createdAt: now,
      },
    ],
  });
});

afterAll(async () => {
  await queues.close();
  connection.disconnect();
  await database.$disconnect();
});

const input = (text: string, subject = "Subject") => ({ workspaceId: "ws-test", subject, text });

const recomputes = async () =>
  (await queues.recompute.getJobs(["waiting", "delayed"])).map(({ data }) => data);

describe("setPriority", () => {
  it("writes a Correction, sets the override, and recompute leaves the ticket alone", async () => {
    const { ticketId } = await triagedTicket(database, { answers: answers({ type: "question" }) });

    const result = await setPriority(deps, { ticketId, priority: "high" }, now);
    // A policy that would move every question: the override still wins.
    await database.policy.create({
      data: { version: 2, values: { ...DEFAULT_POLICY, yesThreshold: 0.01 } },
    });
    const recompute = await recomputeTriages(database, { ticketIds: [ticketId] });

    expect(result).toEqual({ ok: true, changed: true });
    expect(await database.correction.findMany({ where: { ticketId } })).toMatchObject([
      { field: "priority", fromValue: "low", toValue: "high" },
    ]);
    expect(await database.ticket.findUniqueOrThrow({ where: { id: ticketId } })).toMatchObject({
      humanPriority: "high",
      acceptedAt: now,
    });
    expect(recompute).toMatchObject({ compared: 0, skippedHumanSet: 1, updated: 0 });
  });

  it("writes no Correction when the person picks the priority already in force", async () => {
    const { ticketId } = await triagedTicket(database, { answers: answers({ type: "question" }) });

    const result = await setPriority(deps, { ticketId, priority: "low" });

    expect(result.changed).toBe(false);
    expect(await database.correction.count()).toBe(0);
    expect(
      (await database.ticket.findUniqueOrThrow({ where: { id: ticketId } })).humanPriority,
    ).toBe("low");
  });

  it("rejects an unknown priority or ticket", async () => {
    await expect(setPriority(deps, { ticketId: "nope", priority: "high" })).rejects.toThrow(
      /Unknown ticket/,
    );
    expect(setPriorityInput.safeParse({ ticketId: "x", priority: "asap" }).success).toBe(false);
  });
});

describe("acceptTriage", () => {
  it("marks the triage as checked until a new message arrives", async () => {
    const created = await receiveIntake(deps, {
      externalId: "ext-accept",
      workspaceId: "ws-test",
      subject: "Hi",
      message: { id: "m1", text: "First." },
    });

    await acceptTriage(deps, { ticketId: created.ticketId }, now);
    const accepted = await database.ticket.findUniqueOrThrow({ where: { id: created.ticketId } });
    await receiveIntake(deps, {
      externalId: "ext-accept",
      workspaceId: "ws-test",
      subject: "Hi",
      message: { id: "m2", text: "Second." },
    });

    expect(accepted.acceptedAt).toEqual(now);
    expect(
      (await database.ticket.findUniqueOrThrow({ where: { id: created.ticketId } })).acceptedAt,
    ).toBeNull();
  });
});

describe("linkIssue and unlinkIssue", () => {
  it("links a person's issue, keeps a Correction and queues the issue's demand recompute", async () => {
    const { ticketId } = await triagedTicket(database, {
      answers: answers({ type: "feature_request" }),
    });

    const result = await linkIssue(deps, { ticketId, issueId: "librechat#10" });

    expect(result).toEqual({ ok: true });
    expect(await database.ticketIssueLink.findMany({ where: { ticketId } })).toMatchObject([
      { issueId: "librechat#10", origin: "human" },
    ]);
    expect(await database.correction.findMany({ where: { ticketId } })).toMatchObject([
      { field: "duplicate", fromValue: null, toValue: "librechat#10" },
    ]);
    expect(await recomputes()).toEqual([{ reason: "demand", issueId: "librechat#10" }]);
  });

  it("makes Jev's link a person's without a Correction", async () => {
    const { ticketId } = await triagedTicket(database, { answers: answers() });
    await database.ticketIssueLink.create({
      data: { ticketId, issueId: "librechat#11", origin: "jev" },
    });

    await linkIssue(deps, { ticketId, issueId: "librechat#11" });

    expect(await database.ticketIssueLink.findMany({ where: { ticketId } })).toMatchObject([
      { issueId: "librechat#11", origin: "human" },
    ]);
    expect(await database.correction.count()).toBe(0);
  });

  it("refuses an issue of another tracker, or one that doesn't exist", async () => {
    const { ticketId } = await triagedTicket(database, { answers: answers() });

    expect(await linkIssue(deps, { ticketId, issueId: "lobehub#5" })).toEqual({
      ok: false,
      errors: { issueId: ["lobehub#5 isn't in the librechat tracker"] },
    });
    expect(await linkIssue(deps, { ticketId, issueId: "librechat#999" })).toMatchObject({
      ok: false,
    });
    expect(await database.ticketIssueLink.count()).toBe(0);
  });

  it("unlinks, keeps a Correction, and the ticket loses the issue's demand", async () => {
    await createWorkspace(database, { id: "ws-big", arr: 600_000, plan: "enterprise" });
    const other = await triagedTicket(database, {
      workspaceId: "ws-big",
      answers: answers({ type: "feature_request" }),
    });
    const { ticketId } = await triagedTicket(database, {
      answers: answers({ type: "feature_request" }),
    });
    await database.ticketIssueLink.createMany({
      data: [
        { ticketId: other.ticketId, issueId: "librechat#10", origin: "human" },
        { ticketId, issueId: "librechat#10", origin: "jev" },
      ],
    });
    await recomputeTriages(database, { ticketIds: [ticketId] });
    const before = await database.triage.findUniqueOrThrow({ where: { ticketId } });

    await unlinkIssue(deps, { ticketId, issueId: "librechat#10" });

    expect(before.ruleFired).toBe("feature_demand_high");
    expect((await database.triage.findUniqueOrThrow({ where: { ticketId } })).ruleFired).toBe(
      "feature_request",
    );
    expect(await database.correction.findMany({ where: { ticketId } })).toMatchObject([
      { field: "duplicate", fromValue: "librechat#10", toValue: "none" },
    ]);
    expect(await recomputes()).toEqual([{ reason: "demand", issueId: "librechat#10" }]);
  });
});

describe("createIssue", () => {
  it("creates the next issue of the tracker from the ticket, copied, and links the ticket", async () => {
    const created = await receiveIntake(deps, {
      externalId: "ext-issue",
      workspaceId: "ws-test",
      subject: "Please add SCIM group sync",
      message: { id: "m1", text: "We provision every user through SCIM and need groups too." },
    });
    await receiveIntake(deps, {
      externalId: "ext-issue",
      workspaceId: "ws-test",
      subject: "Please add SCIM group sync",
      message: { id: "m2", from: "support", text: "Thanks, noted." },
    });

    const result = await createIssue(
      deps,
      { ticketId: created.ticketId, title: "  SCIM group sync  " },
      now,
    );

    expect(result).toEqual({ ok: true, issueId: "librechat#12" });
    expect(await database.issue.findUniqueOrThrow({ where: { id: "librechat#12" } })).toMatchObject(
      {
        tracker: "librechat",
        number: 12,
        source: "app",
        title: "SCIM group sync",
        body: "We provision every user through SCIM and need groups too.",
      },
    );
    expect(
      await database.ticketIssueLink.findMany({ where: { ticketId: created.ticketId } }),
    ).toMatchObject([{ issueId: "librechat#12", origin: "human" }]);
    expect(
      await database.correction.findMany({ where: { ticketId: created.ticketId } }),
    ).toMatchObject([{ field: "duplicate", fromValue: null, toValue: "librechat#12" }]);
    expect(await recomputes()).toEqual([{ reason: "demand", issueId: "librechat#12" }]);
    // The search trigger indexed it, so later tickets get it as a candidate.
    const candidates = await findCandidates(database, {
      tracker: "librechat",
      ticket: {
        subject: "SCIM groups",
        messages: [{ from: "customer", text: "We need SCIM group sync." }],
      },
      before: new Date(now.getTime() + 60_000),
      excludeIssueId: null,
    });
    expect(candidates.map(({ issueId }) => issueId)).toContain("librechat#12");
  });

  it("caps the title at 200 characters and rejects an empty one", async () => {
    const { ticketId } = await triagedTicket(database, { answers: answers() });

    expect(await createIssue(deps, { ticketId, title: "x".repeat(201) })).toMatchObject({
      ok: false,
      errors: { title: [expect.any(String)] },
    });
    expect(await createIssue(deps, { ticketId, title: "   " })).toMatchObject({ ok: false });
    expect(await createIssue(deps, { ticketId, title: "x".repeat(200) })).toMatchObject({
      ok: true,
    });
  });
});

describe("Try it", () => {
  it("takes a ticket of exactly 8,000 characters and queues its triage", async () => {
    const subject = "Exports lose chats";
    const result = await submitTryIt(
      deps,
      input("x".repeat(TRY_IT_MAX_CHARS - subject.length), subject),
    );

    if (!result.ok) throw new Error("expected the ticket to be taken");
    expect(
      await database.ticket.findUniqueOrThrow({ where: { id: result.ticketId } }),
    ).toMatchObject({
      source: "try_it",
    });
    expect(await queues.triage.getJob(`triage-${result.ticketId}-1`)).toBeTruthy();
  });

  it("refuses 8,001 characters, and stores nothing", async () => {
    const result = await submitTryIt(deps, input("x".repeat(TRY_IT_MAX_CHARS - 6), "Subjec!"));

    expect(result).toMatchObject({
      ok: false,
      errors: { text: [expect.stringContaining("8,000")] },
    });
    expect(await database.ticket.count()).toBe(0);
  });

  it("refuses a reply that takes the ticket over 8,000 characters", async () => {
    const created = await submitTryIt(deps, input("x".repeat(7_000)));
    if (!created.ok) throw new Error("expected the ticket to be taken");

    const tooLong = await addTryItReply(deps, {
      ticketId: created.ticketId,
      text: "y".repeat(1_000),
    });
    const fits = await addTryItReply(deps, { ticketId: created.ticketId, text: "y".repeat(993) });

    expect(tooLong).toMatchObject({
      ok: false,
      errors: { text: [expect.stringContaining("8,000")] },
    });
    expect(fits).toEqual({ ok: true, messageCount: 2 });
    expect(await queues.triage.getJob(`triage-${created.ticketId}-2`)).toBeTruthy();
  });

  it("takes replies only on Try-it tickets, and checks the workspace", async () => {
    const { ticketId } = await triagedTicket(database, { answers: answers() });

    expect(await addTryItReply(deps, { ticketId, text: "Hi" })).toMatchObject({ ok: false });
    expect(await submitTryIt(deps, { ...input("Hi"), workspaceId: "ws-nope" })).toEqual({
      ok: false,
      errors: { workspaceId: ["No such workspace"] },
    });
  });

  it("sends the incident burst as new intake tickets, a new burst each time", async () => {
    await database.workspace.createMany({
      data: loadIncidentBurst().map(({ workspaceId }) => ({
        id: workspaceId,
        name: workspaceId,
        tracker: "librechat",
        plan: "business",
        seats: 10,
        arr: 1_000,
      })),
      skipDuplicates: true,
    });

    const first = await simulateIncident(deps, { run: "a" });
    const second = await simulateIncident(deps, { run: "b" });

    expect(first.ticketIds).toHaveLength(6);
    expect(await database.ticket.count({ where: { source: "intake" } })).toBe(12);
    expect(new Set([...first.ticketIds, ...second.ticketIds]).size).toBe(12);
    expect(await queues.triage.count()).toBe(12);
  });

  it("is removed by the next seed", async () => {
    await seedDemo({ db: database, provider: createFakeProvider(), now, items: [] });
    const created = await submitTryIt(deps, input("Hello"));
    if (!created.ok) throw new Error("expected the ticket to be taken");

    await seedDemo({ db: database, provider: createFakeProvider(), now, items: [] });

    expect(await database.ticket.count({ where: { source: "try_it" } })).toBe(0);
  });
});
