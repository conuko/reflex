import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { loadIssueCorpus, TRACKERS } from "@/lib/issue-corpus";
import { AREAS, TICKET_TYPES } from "@/lib/triage/questions";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const issue = (number: number, overrides: Record<string, unknown> = {}) => ({
  number,
  title: `Issue ${number}`,
  body: "Something happened.",
  createdAt: `2026-04-${String(number % 28 || 1).padStart(2, "0")}T10:00:00Z`,
  closedAt: null,
  type: "bug",
  area: "chat",
  priority: "medium",
  duplicateOf: null,
  ...overrides,
});

function corpusDir(issues: unknown[]): string {
  const dir = mkdtempSync(join(tmpdir(), "reflex-corpus-"));
  dirs.push(dir);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "librechat.json"), JSON.stringify({ tracker: "librechat", issues }));
  return dir;
}

describe("loadIssueCorpus", () => {
  it("returns each issue with its tracker and an id", () => {
    const dir = corpusDir([
      issue(1),
      issue(2, { duplicateOf: 1, closedAt: "2026-04-05T10:00:00Z" }),
    ]);

    expect(loadIssueCorpus(dir)).toEqual([
      expect.objectContaining({ id: "librechat#1", tracker: "librechat", number: 1 }),
      expect.objectContaining({ id: "librechat#2", tracker: "librechat", duplicateOf: 1 }),
    ]);
  });

  it("rejects a duplicate whose original is newer", () => {
    const dir = corpusDir([
      issue(1, { duplicateOf: 2, closedAt: "2026-04-05T10:00:00Z" }),
      issue(2),
    ]);

    expect(() => loadIssueCorpus(dir)).toThrow("librechat#1 duplicates a newer issue");
  });

  it("rejects a duplicate of an issue that doesn't exist", () => {
    const dir = corpusDir([issue(2, { duplicateOf: 1, closedAt: "2026-04-05T10:00:00Z" })]);

    expect(() => loadIssueCorpus(dir)).toThrow("librechat#2 duplicates a missing issue");
  });

  it("rejects a duplicate of a duplicate", () => {
    const dir = corpusDir([
      issue(1),
      issue(2, { duplicateOf: 1, closedAt: "2026-04-05T10:00:00Z" }),
      issue(3, { duplicateOf: 2, closedAt: "2026-04-06T10:00:00Z" }),
    ]);

    expect(() => loadIssueCorpus(dir)).toThrow("librechat#3 duplicates another duplicate");
  });

  it("rejects a duplicate that is still open", () => {
    const dir = corpusDir([issue(1), issue(2, { duplicateOf: 1 })]);

    expect(() => loadIssueCorpus(dir)).toThrow("librechat#2 is a duplicate but still open");
  });

  it("rejects an issue closed before it was created", () => {
    const dir = corpusDir([issue(3, { closedAt: "2026-03-01T00:00:00Z" })]);

    expect(() => loadIssueCorpus(dir)).toThrow("librechat#3 was closed before it was created");
  });

  it("rejects a repeated issue number", () => {
    const dir = corpusDir([issue(1), issue(1)]);

    expect(() => loadIssueCorpus(dir)).toThrow("librechat#1 appears more than once");
  });

  it("rejects a label outside Reflex's vocabulary", () => {
    const dir = corpusDir([issue(1, { area: "billing" })]);

    expect(() => loadIssueCorpus(dir)).toThrow(/area/);
  });
});

describe("the committed issue corpus", () => {
  const corpus = loadIssueCorpus();

  it.each(TRACKERS)("has 40 issues for %s", (tracker) => {
    expect(corpus.filter((i) => i.tracker === tracker)).toHaveLength(40);
  });

  it.each(TRACKERS)("labels every type and every area in %s", (tracker) => {
    const issues = corpus.filter((i) => i.tracker === tracker);

    expect(new Set(issues.map((i) => i.type))).toEqual(new Set(TICKET_TYPES));
    expect(new Set(issues.map((i) => i.area))).toEqual(new Set(AREAS));
  });

  it.each(TRACKERS)("has 6 duplicates in %s", (tracker) => {
    const duplicates = corpus.filter((i) => i.tracker === tracker && i.duplicateOf !== null);

    expect(duplicates).toHaveLength(6);
  });

  it("is written in plain ASCII text (English only)", () => {
    const nonAscii = corpus.filter((i) => !/^[\x20-\x7E\n]*$/.test(`${i.title}\n${i.body}`));

    expect(nonAscii.map((i) => i.id)).toEqual([]);
  });
});
