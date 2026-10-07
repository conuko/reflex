import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { DEFAULT_POLICY } from "@/lib/policy-schema";
import { demandOverview } from "@/lib/reads/demand";
import { listInbox } from "@/lib/reads/inbox";
import { openIncidents } from "@/lib/reads/incidents";
import { listWorkspaces, searchIssues } from "@/lib/reads/lookups";
import { policyVersions } from "@/lib/reads/policy";
import { ticketDetail } from "@/lib/reads/ticket";
import { recomputeTriages } from "@/lib/recompute";
import { applyJudgment, storeJudgment } from "@/lib/triage/run-triage";

import { answers } from "../support/answers";
import {
  createWorkspace,
  judgmentFor,
  resetDatabase,
  testDb,
  triagedTicket,
} from "../support/pipeline";

// The server-side reads behind the app's pages and JSON routes (plan M5).

const database = testDb();
const now = new Date("2026-10-07T09:00:00Z");
const minutesAgo = (minutes: number) => new Date(now.getTime() - minutes * 60_000);

beforeEach(async () => {
  await resetDatabase(database);
  await createWorkspace(database);
  await database.issue.createMany({
    data: [
      {
        id: "librechat#1",
        tracker: "librechat",
        number: 1,
        title: "Export to PDF",
        body: "Please.",
        createdAt: minutesAgo(9_000),
      },
      {
        id: "librechat#2",
        tracker: "librechat",
        number: 2,
        title: "Okta redirect loop",
        body: "Loops.",
        createdAt: minutesAgo(9_000),
      },
      {
        id: "librechat#3",
        tracker: "librechat",
        number: 3,
        title: "Okta loop again",
        body: "Same.",
        createdAt: minutesAgo(9_000),
        duplicateOf: "librechat#2",
      },
      {
        id: "lobehub#1",
        tracker: "lobehub",
        number: 1,
        title: "Okta on lobehub",
        body: "Loops.",
        createdAt: minutesAgo(9_000),
      },
    ],
  });
});

afterAll(async () => {
  await database.$disconnect();
});

const pick = (issueId: string | null, probability = 0.9) => ({
  choice: issueId ? "c1" : "none",
  probability,
  probabilities: issueId
    ? { none: 1 - probability, c1: probability, c2: 0 }
    : { none: probability, c1: 1 - probability, c2: 0 },
  issueId,
});

describe("listInbox", () => {
  it("sorts by the priority in force, newest first within one, with tickets still triaging on top", async () => {
    const low = await triagedTicket(database, {
      answers: answers({ type: "question" }),
      createdAt: minutesAgo(5),
    });
    const urgent = await triagedTicket(database, {
      answers: answers({ dataLoss: 0.9 }),
      createdAt: minutesAgo(60),
    });
    const newerLow = await triagedTicket(database, {
      answers: answers({ type: "question" }),
      createdAt: minutesAgo(1),
    });
    const overridden = await triagedTicket(database, {
      answers: answers({ type: "question" }),
      createdAt: minutesAgo(30),
    });
    await database.ticket.update({
      where: { id: overridden.ticketId },
      data: { humanPriority: "high" },
    });
    const pending = await database.ticket.create({
      data: {
        externalId: "pending",
        source: "intake",
        workspaceId: "ws-test",
        subject: "Just arrived",
        createdAt: minutesAgo(2),
        messages: {
          create: {
            position: 0,
            externalId: "m1",
            from: "customer",
            text: "Hi",
            createdAt: minutesAgo(2),
          },
        },
      },
    });

    const { rows, policy } = await listInbox(database);

    expect(rows.map(({ id }) => id)).toEqual([
      pending.id,
      urgent.ticketId,
      overridden.ticketId,
      newerLow.ticketId,
      low.ticketId,
    ]);
    expect(rows[0]).toMatchObject({ priority: null, triaging: true, type: null });
    expect(rows[2]).toMatchObject({
      priority: "high",
      suggested: "low",
      humanSet: true,
      type: "question",
    });
    expect(policy.version).toBe(1);
  });

  it("shows what the last policy save moved, and a re-triage in progress", async () => {
    const { ticketId } = await triagedTicket(database, {
      answers: answers({ blocked: 0.55 }),
      createdAt: minutesAgo(10),
    });
    await database.policy.create({
      data: { version: 2, values: { ...DEFAULT_POLICY, yesThreshold: 0.6 } },
    });
    await recomputeTriages(database);
    await database.message.create({
      data: {
        ticketId,
        position: 1,
        externalId: "m2",
        from: "customer",
        text: "More.",
        createdAt: now,
      },
    });

    const { rows, policy } = await listInbox(database);

    expect(policy.version).toBe(2);
    expect(rows[0]).toMatchObject({
      priority: "low",
      previousPriority: "medium",
      triaging: true,
      messageCount: 2,
    });
    expect((rows[0]?.priorityChangedAt ?? "") >= policy.savedAt).toBe(true);
  });
});

describe("ticketDetail", () => {
  it("returns the thread, the trace with its policy, Jev's candidates by probability, links and demand", async () => {
    const created = await database.ticket.create({
      data: {
        externalId: "detail",
        source: "intake",
        workspaceId: "ws-test",
        subject: "Okta loops",
        createdAt: minutesAgo(10),
        messages: {
          create: {
            position: 0,
            externalId: "m1",
            from: "customer",
            text: "Loops forever.",
            createdAt: minutesAgo(10),
          },
        },
      },
    });
    const judged = answers({ duplicate: pick("librechat#2", 0.8) });
    const judgment = {
      ...judgmentFor(judged),
      candidateMap: { c1: "librechat#2", c2: "librechat#1" },
    };
    const judgmentId = await storeJudgment(database, created.id, judgment, "live");
    await applyJudgment(database, {
      ticketId: created.id,
      judgmentId,
      answers: judged,
      messageCount: 1,
    });

    const detail = await ticketDetail(database, created.id, { now });

    expect(detail).toMatchObject({
      subject: "Okta loops",
      workspace: { id: "ws-test", plan: "business", tracker: "librechat" },
      messages: [{ position: 0, from: "customer", text: "Loops forever." }],
      priority: "low",
      triaging: false,
      triage: { ruleFired: "bug", policyVersion: 1, policy: DEFAULT_POLICY, messageCount: 1 },
      judgment: { id: judgmentId, origin: "live" },
      candidates: [
        { key: "c1", issueId: "librechat#2", title: "Okta redirect loop", probability: 0.8 },
        { key: "c2", issueId: "librechat#1", title: "Export to PDF", probability: 0 },
      ],
      links: [{ issueId: "librechat#2", origin: "jev", title: "Okta redirect loop" }],
      demand: [{ issueId: "librechat#2", tickets: 1, workspaces: 1, arr: 15_000 }],
    });
    expect(detail?.noneProbability).toBeCloseTo(0.2);
    expect(detail?.triage?.trace.at(-1)).toMatchObject({ rule: "bug", matched: true });
    expect(detail?.judgments).toHaveLength(1);
  });

  it("returns null for an unknown ticket", async () => {
    expect(await ticketDetail(database, "nope")).toBeNull();
  });
});

describe("openIncidents", () => {
  it("labels each open incident from its group", async () => {
    await database.incident.createMany({
      data: [
        {
          groupKey: "issue:librechat#2",
          windowStart: minutesAgo(20),
          openedAt: minutesAgo(5),
          ticketCount: 6,
        },
        {
          groupKey: "area:lobehub:agents",
          windowStart: minutesAgo(25),
          openedAt: minutesAgo(10),
          ticketCount: 5,
        },
        {
          groupKey: "area:lobehub:chat",
          windowStart: minutesAgo(90),
          ticketCount: 5,
          closedAt: minutesAgo(30),
        },
      ],
    });

    const incidents = await openIncidents(database);

    expect(incidents.map(({ label, ticketCount }) => [label, ticketCount])).toEqual([
      ["librechat#2: Okta redirect loop", 6],
      ["Agents in lobehub", 5],
    ]);
  });
});

describe("demandOverview", () => {
  it("lists linked issues by demand, and groups Won't-do requests by non-goal", async () => {
    await createWorkspace(database, { id: "ws-big", plan: "enterprise", arr: 400_000 });
    const asks = { self_hosting: 0.95, native_mobile_apps: 0.05, media_generation: 0.05 };
    const onPrem = await triagedTicket(database, {
      workspaceId: "ws-big",
      answers: answers({ type: "feature_request", nonGoals: asks }),
    });
    const small = await triagedTicket(database, {
      answers: answers({ type: "feature_request", nonGoals: asks }),
    });
    const overridden = await triagedTicket(database, {
      answers: answers({ type: "feature_request", nonGoals: asks }),
    });
    await database.ticket.update({
      where: { id: overridden.ticketId },
      data: { humanPriority: "medium" },
    });
    const linked = await triagedTicket(database, {
      workspaceId: "ws-big",
      answers: answers({ type: "feature_request" }),
    });
    await database.ticketIssueLink.create({
      data: { ticketId: linked.ticketId, issueId: "librechat#1", origin: "human" },
    });

    const { issues, wontDo } = await demandOverview(database, { now });

    expect(issues).toMatchObject([
      { issueId: "librechat#1", title: "Export to PDF", tickets: 1, workspaces: 1, arr: 400_000 },
    ]);
    const selfHosting = wontDo.find(({ nonGoal }) => nonGoal === "self_hosting");
    expect(selfHosting).toMatchObject({ label: "Self-hosting", workspaces: 2, arr: 415_000 });
    // The ticket a person set to Medium is no longer a Won't do.
    expect(selfHosting?.tickets.map(({ id }) => id).toSorted()).toEqual(
      [onPrem.ticketId, small.ticketId].toSorted(),
    );
    expect(wontDo.find(({ nonGoal }) => nonGoal === "native_mobile_apps")?.tickets).toEqual([]);
  });
});

describe("policyVersions, searchIssues and listWorkspaces", () => {
  it("lists policy versions newest first", async () => {
    await database.policy.createMany({
      data: [
        { version: 1, values: DEFAULT_POLICY },
        { version: 2, values: { ...DEFAULT_POLICY, enterpriseRaisesOneLevel: true } },
      ],
    });

    const versions = await policyVersions(database);

    expect(versions.map(({ version }) => version)).toEqual([2, 1]);
    expect(versions[0]?.values.enterpriseRaisesOneLevel).toBe(true);
  });

  it("finds original issues of one tracker by title or id", async () => {
    const byTitle = await searchIssues(database, { tracker: "librechat", query: "okta" });
    const byId = await searchIssues(database, { tracker: "librechat", query: "#1" });
    const all = await searchIssues(database, { tracker: "librechat", query: "" });

    expect(byTitle.map(({ id }) => id)).toEqual(["librechat#2"]);
    expect(byId.map(({ id }) => id)).toEqual(["librechat#1"]);
    expect(all.map(({ id }) => id).toSorted()).toEqual(["librechat#1", "librechat#2"]);
  });

  it("lists workspaces with their plan and tracker", async () => {
    expect(await listWorkspaces(database)).toEqual([
      {
        id: "ws-test",
        name: "Test Workspace",
        plan: "business",
        tracker: "librechat",
        arr: 15_000,
      },
    ]);
  });
});
