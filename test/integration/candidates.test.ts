import { readFileSync } from "node:fs";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import type { CorpusIssue } from "@/lib/issue-corpus";

import { createDb } from "@/lib/db";
import { scriptEnv } from "@/lib/env";
import {
  buildCandidateSnapshot,
  CANDIDATES_FILE,
  serializeCandidateSnapshot,
} from "@/lib/eval/candidates-snapshot";
import { loadEvalItems } from "@/lib/eval/sets";
import { importIssueCorpus } from "@/lib/issues";
import { findCandidates } from "@/lib/triage/candidates";

const database = createDb(scriptEnv("DATABASE_URL").DATABASE_URL);

afterAll(async () => {
  await database.$disconnect();
});

const issue = (number: number, overrides: Partial<CorpusIssue> = {}): CorpusIssue => ({
  id: `librechat#${number}`,
  tracker: "librechat",
  number,
  title: `Issue ${number}`,
  body: "Something unrelated happened.",
  createdAt: "2026-04-01T10:00:00Z",
  closedAt: null,
  type: "bug",
  area: "chat",
  priority: "low",
  duplicateOf: null,
  ...overrides,
});

const okta = (number: number, overrides: Partial<CorpusIssue> = {}) =>
  issue(number, {
    title: "Okta SSO redirect loop after the release",
    body: "Users authenticate in Okta and land on the login page again.",
    ...overrides,
  });

const ticket = (subject: string, text = "") => ({
  subject,
  messages: [{ from: "customer" as const, text }],
});

const later = new Date("2026-09-30T10:00:00Z");

async function search(subject: string, text = "", overrides = {}) {
  const candidates = await findCandidates(database, {
    tracker: "librechat",
    ticket: ticket(subject, text),
    before: later,
    ...overrides,
  });
  return candidates.map(({ issueId }) => issueId);
}

describe("findCandidates", () => {
  beforeEach(async () => {
    await database.issue.deleteMany();
  });

  it("finds the issue that shares the ticket's distinctive words, best match first", async () => {
    await importIssueCorpus(database, [
      issue(1, { title: "Export to CSV is slow", body: "Exports of large reports take minutes." }),
      okta(2),
      issue(3, { title: "Okta groups are not synced", body: "SCIM group push fails." }),
    ]);

    const found = await search(
      "Login loop with Okta",
      "After the release we are stuck in a redirect loop.",
    );

    expect(found[0]).toBe("librechat#2");
    expect(found).not.toContain("librechat#1");
  });

  it("offers only issues of the ticket's tracker", async () => {
    await importIssueCorpus(database, [
      okta(1),
      { ...okta(2), id: "lobehub#2", tracker: "lobehub" },
    ]);

    expect(await search("Okta redirect loop")).toEqual(["librechat#1"]);
  });

  it("offers only issues created before the ticket", async () => {
    await importIssueCorpus(database, [okta(1), okta(2, { createdAt: "2026-10-01T10:00:00Z" })]);

    expect(await search("Okta redirect loop")).toEqual(["librechat#1"]);
  });

  it("offers only canonical issues, never a duplicate", async () => {
    await importIssueCorpus(database, [
      okta(1),
      okta(2, {
        createdAt: "2026-04-02T10:00:00Z",
        closedAt: "2026-04-03T10:00:00Z",
        duplicateOf: 1,
      }),
    ]);

    expect(await search("Okta redirect loop")).toEqual(["librechat#1"]);
  });

  it("never offers the ticket's own issue", async () => {
    await importIssueCorpus(database, [okta(1), okta(2)]);

    expect(await search("Okta redirect loop", "", { excludeIssueId: "librechat#2" })).toEqual([
      "librechat#1",
    ]);
  });

  it("takes an issue's state as of the ticket's time", async () => {
    await importIssueCorpus(database, [okta(1, { closedAt: "2026-06-01T10:00:00Z" })]);

    const stateAt = async (before: string) => {
      const [candidate] = await findCandidates(database, {
        tracker: "librechat",
        ticket: ticket("Okta redirect loop"),
        before: new Date(before),
      });
      return candidate?.state;
    };

    expect(await stateAt("2026-05-01T10:00:00Z")).toBe("open");
    expect(await stateAt("2026-07-01T10:00:00Z")).toBe("closed");
  });

  it("returns at most 10 candidates, ranked from 0 to 1", async () => {
    await importIssueCorpus(
      database,
      Array.from({ length: 15 }, (_, i) => okta(i + 1)),
    );

    const candidates = await findCandidates(database, {
      tracker: "librechat",
      ticket: ticket("Okta redirect loop"),
      before: later,
    });

    expect(candidates).toHaveLength(10);
    expect(candidates.every(({ rank }) => rank > 0 && rank < 1)).toBe(true);
  });

  it("treats SQL and search syntax in the ticket as plain words", async () => {
    await importIssueCorpus(database, [okta(1)]);

    const found = await search(`Okta'); DROP TABLE "Issue"; --`, "loop & | ! :* <-> ( redirect");

    expect(found).toEqual(["librechat#1"]);
    expect(await database.issue.count()).toBe(1);
  });

  it("returns nothing when no word of the ticket appears in an issue", async () => {
    await importIssueCorpus(database, [okta(1)]);

    expect(await search("Invoice currency", "Please bill us in euros.")).toEqual([]);
  });
});

describe("the committed candidate snapshot", () => {
  it("is what the search gives for the committed data", async () => {
    await database.issue.deleteMany();
    await importIssueCorpus(database);

    const snapshot = await buildCandidateSnapshot(database, loadEvalItems());

    expect(serializeCandidateSnapshot(snapshot)).toBe(readFileSync(CANDIDATES_FILE, "utf8"));
  });
});
