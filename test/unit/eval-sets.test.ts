import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ZodError } from "zod";

import { NON_GOALS } from "@/lib/config/non-goals";
import { loadEvalItems } from "@/lib/eval/sets";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const issue = (number: number, overrides: Record<string, unknown> = {}) => ({
  number,
  title: `Issue ${number}`,
  body: "### What happened?\n\nIt broke.",
  createdAt: "2026-04-01T10:00:00Z",
  closedAt: null,
  type: "bug",
  area: "chat",
  priority: "medium",
  duplicateOf: null,
  ...overrides,
});

const goldLabels = (overrides: Record<string, unknown> = {}) => ({
  type: "bug",
  area: "chat",
  priority: "low",
  reach: "one_user",
  blocked: false,
  workaround: false,
  regression: false,
  dataExposure: false,
  dataLoss: false,
  nonGoal: null,
  injection: false,
  duplicateOf: null,
  attackTarget: null,
  ...overrides,
});

const ticket = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  tracker: "librechat",
  createdAt: "2026-09-30T10:00:00Z",
  subject: "Subject",
  messages: [{ from: "customer", text: "Text." }],
  gold: goldLabels(),
  ...overrides,
});

function write(dir: string, file: string, value: unknown) {
  writeFileSync(join(dir, file), JSON.stringify(value));
}

function fixture({
  issues = [
    issue(1),
    issue(2, {
      createdAt: "2026-04-02T10:00:00Z",
      closedAt: "2026-04-03T10:00:00Z",
      duplicateOf: 1,
    }),
  ],
  support = [ticket("support-01")],
  adversarial = [] as unknown[],
  nonGoals = {},
}: {
  issues?: unknown[];
  support?: unknown[];
  adversarial?: unknown[];
  nonGoals?: Record<string, string>;
} = {}) {
  const root = mkdtempSync(join(tmpdir(), "reflex-eval-sets-"));
  dirs.push(root);
  const corpusDir = join(root, "issues");
  const evalDir = join(root, "eval");
  mkdirSync(corpusDir);
  mkdirSync(evalDir);

  write(corpusDir, "librechat.json", { tracker: "librechat", issues });
  write(corpusDir, "lobehub.json", { tracker: "lobehub", issues: [issue(9001)] });
  write(evalDir, "corpus-nongoals.json", { note: "", nonGoals });
  write(evalDir, "support.json", { set: "support", note: "", tickets: support });
  write(evalDir, "adversarial.json", { set: "adversarial", note: "", tickets: adversarial });
  return { corpusDir, evalDir };
}

describe("loadEvalItems", () => {
  it("turns corpus issues into tickets without their headings", () => {
    const items = loadEvalItems(fixture({ nonGoals: { "librechat#1": "self_hosting" } }));

    expect(items.find(({ id }) => id === "librechat#2")).toEqual({
      id: "librechat#2",
      set: "corpus",
      tracker: "librechat",
      createdAt: "2026-04-02T10:00:00Z",
      ticket: { subject: "Issue 2", messages: [{ from: "customer", text: "It broke." }] },
      gold: {
        type: "bug",
        area: "chat",
        priority: "medium",
        duplicateOf: "librechat#1",
        nonGoal: null,
        signals: null,
        attackTarget: null,
      },
    });
    expect(items.find(({ id }) => id === "librechat#1")?.gold.nonGoal).toBe("self_hosting");
  });

  it("reads the hand-written sets with their signal labels", () => {
    const items = loadEvalItems(
      fixture({
        support: [ticket("support-01", { gold: goldLabels({ duplicateOf: "librechat#1" }) })],
        adversarial: [
          ticket("adversarial-01", {
            gold: goldLabels({ injection: true, attackTarget: { priority: "urgent" } }),
          }),
        ],
      }),
    );

    expect(items.map(({ id, set }) => `${set}:${id}`).slice(-2)).toEqual([
      "support:support-01",
      "adversarial:adversarial-01",
    ]);
    expect(items.at(-2)?.gold).toMatchObject({
      duplicateOf: "librechat#1",
      signals: { reach: "one_user", blocked: false, injection: false },
    });
    expect(items.at(-1)?.gold.attackTarget).toEqual({ priority: "urgent" });
  });

  it.each([
    ["a duplicate of a missing issue", { duplicateOf: "librechat#99" }, "missing issue"],
    ["a duplicate from another tracker", { duplicateOf: "lobehub#9001" }, "another tracker"],
    ["a duplicate of a duplicate", { duplicateOf: "librechat#2" }, "itself a duplicate"],
    [
      "an attack target without an injection",
      { attackTarget: { priority: "urgent" } },
      "attackTarget",
    ],
    ["an injection without an attack target", { injection: true }, "attackTarget"],
  ])("rejects %s", (_, overrides, message) => {
    const dir = fixture({ support: [ticket("support-01", { gold: goldLabels(overrides) })] });

    expect(() => loadEvalItems(dir)).toThrow(message);
  });

  it("rejects a duplicate of an issue created after the ticket", () => {
    const dir = fixture({
      support: [
        ticket("support-01", {
          createdAt: "2026-03-01T10:00:00Z",
          gold: goldLabels({ duplicateOf: "librechat#1" }),
        }),
      ],
    });

    expect(() => loadEvalItems(dir)).toThrow("newer");
  });

  it.each([
    ["a label outside the vocabulary", { gold: goldLabels({ area: "billing" }) }],
    ["an unknown non-goal", { gold: goldLabels({ nonGoal: "teleportation" }) }],
    ["an empty attack target", { gold: goldLabels({ injection: true, attackTarget: {} }) }],
    ["a missing gold field", { gold: { ...goldLabels(), reach: undefined } }],
    ["an extra gold field", { gold: goldLabels({ frustration: 2 }) }],
    ["a thread that starts with support", { messages: [{ from: "support", text: "Hi" }] }],
    [
      "a message longer than the state keeps",
      { messages: [{ from: "customer", text: "x".repeat(2_501) }] },
    ],
    ["an id from another set", { id: "adversarial-01" }],
  ])("rejects %s", (_, overrides) => {
    expect(() => loadEvalItems(fixture({ support: [ticket("support-01", overrides)] }))).toThrow(
      ZodError,
    );
  });

  it("rejects a repeated id", () => {
    const dir = fixture({ support: [ticket("support-01"), ticket("support-01")] });

    expect(() => loadEvalItems(dir)).toThrow("more than once");
  });

  it("rejects non-goal labels for missing corpus issues or unknown non-goals", () => {
    expect(() => loadEvalItems(fixture({ nonGoals: { "librechat#99": "self_hosting" } }))).toThrow(
      "missing issue",
    );
    expect(() => loadEvalItems(fixture({ nonGoals: { "librechat#1": "teleportation" } }))).toThrow(
      "is not a known non-goal",
    );
  });
});

describe("the committed eval sets", () => {
  const items = loadEvalItems();
  const inSet = (set: string) => items.filter((item) => item.set === set);

  it("hold 80 corpus issues, 60 support tickets and 40 adversarial tickets", () => {
    expect(
      [inSet("corpus"), inSet("support"), inSet("adversarial")].map((set) => set.length),
    ).toEqual([80, 60, 40]);
  });

  it("have about 25 support tickets that duplicate at least 15 distinct issues", () => {
    const originals = inSet("support").flatMap(({ gold }) => gold.duplicateOf ?? []);

    expect(originals.length).toBeGreaterThanOrEqual(25);
    expect(new Set(originals).size).toBeGreaterThanOrEqual(15);
  });

  it("cover every support category and every non-goal", () => {
    const support = inSet("support");
    const count = (test: (item: (typeof support)[number]) => boolean) =>
      support.filter(test).length;

    expect(count(({ gold }) => gold.type === "account_billing")).toBeGreaterThanOrEqual(5);
    expect(count(({ gold }) => gold.area === "admin_sso")).toBeGreaterThanOrEqual(5);
    expect(count(({ gold }) => gold.signals?.dataExposure === true)).toBeGreaterThanOrEqual(4);
    expect(count(({ gold }) => gold.signals?.dataLoss === true)).toBeGreaterThanOrEqual(4);
    const perNonGoal = Object.fromEntries(
      NON_GOALS.map(({ id }) => [id, count(({ gold }) => gold.nonGoal === id) >= 2]),
    );
    expect(perNonGoal).toEqual(Object.fromEntries(NON_GOALS.map(({ id }) => [id, true])));
  });

  it("have 20 injections and 20 benign controls", () => {
    const injections = inSet("adversarial").filter(({ gold }) => gold.signals?.injection);

    expect(injections).toHaveLength(20);
  });
});
