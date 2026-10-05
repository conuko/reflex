import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import type { EvalItem, EvalSet, Gold } from "@/lib/eval/sets";

import { loadEvalItems } from "@/lib/eval/sets";
import {
  buildSplit,
  checkSplit,
  loadMirrors,
  readSplit,
  serializeSplit,
  SPLIT_FILE,
  splitPart,
} from "@/lib/eval/split";
import { TICKET_TYPES } from "@/lib/triage/questions";

const item = (id: string, gold: Partial<Gold> = {}, set: EvalSet = "corpus"): EvalItem => ({
  id,
  set,
  tracker: "librechat",
  createdAt: "2026-04-01T10:00:00Z",
  ticket: { subject: id, messages: [{ from: "customer", text: id }] },
  gold: {
    type: "bug",
    area: "chat",
    priority: "low",
    duplicateOf: null,
    nonGoal: null,
    signals: null,
    attackTarget: null,
    ...gold,
  },
});

const injection = (id: string): EvalItem =>
  item(
    id,
    {
      signals: {
        reach: "one_user",
        blocked: false,
        workaround: false,
        regression: false,
        dataExposure: false,
        dataLoss: false,
        injection: true,
      },
      attackTarget: { priority: "urgent" },
    },
    "adversarial",
  );

const partOf = (split: { dev: string[] }, id: string) => (split.dev.includes(id) ? "dev" : "test");

describe("buildSplit", () => {
  const items = Array.from({ length: 30 }, (_, i) => item(`librechat#${100 + i}`));

  it("puts every item in exactly one part, about a third in dev", () => {
    const split = buildSplit(items, []);

    expect([...split.dev, ...split.test].toSorted()).toEqual(items.map(({ id }) => id).toSorted());
    expect(split.dev).toHaveLength(10);
  });

  it("gives the same split every time", () => {
    expect(serializeSplit(buildSplit(items, []))).toBe(
      serializeSplit(buildSplit(items.toReversed(), [])),
    );
  });

  it("keeps a duplicate with its original, and mirror issues together", () => {
    const linked = [
      ...items,
      item("support-01", { duplicateOf: "librechat#100" }, "support"),
      item("support-02", { duplicateOf: "librechat#101" }, "support"),
    ];
    const mirrors: [string, string][] = [
      ["librechat#102", "librechat#103"],
      ["librechat#104", "librechat#105"],
    ];

    const split = buildSplit(linked, mirrors);

    for (const [a, b] of [
      ["support-01", "librechat#100"],
      ["support-02", "librechat#101"],
      ...mirrors,
    ]) {
      expect(partOf(split, a)).toBe(partOf(split, b));
    }
  });

  it("spreads duplicates and injections over both parts", () => {
    const mixed = [
      ...items,
      ...Array.from({ length: 9 }, (_, i) =>
        injection(`adversarial-${String(i + 1).padStart(2, "0")}`),
      ),
    ];

    const split = buildSplit(mixed, []);

    expect(split.dev.filter((id) => id.startsWith("adversarial-"))).toHaveLength(3);
  });

  it("refuses a mirror pair that names an unknown item", () => {
    expect(() => buildSplit(items, [["librechat#100", "lobehub#1"]])).toThrow("not an eval item");
  });
});

describe("checkSplit", () => {
  it("names what dev is missing", () => {
    const items = [item("librechat#1")];

    expect(() => checkSplit({ version: "v1", dev: ["librechat#1"], test: [] }, items)).toThrow(
      /no feature_request item.*only 0 duplicates.*only 0 injections/,
    );
  });
});

describe("splitPart", () => {
  const items = [item("librechat#1"), item("librechat#2")];

  it("returns the ids of one part", () => {
    expect(
      splitPart({ version: "v1", dev: ["librechat#1"], test: ["librechat#2"] }, items, "test"),
    ).toEqual(["librechat#2"]);
  });

  it.each([
    ["an item is missing", { version: "v1", dev: ["librechat#1"], test: [] }],
    [
      "an id is unknown",
      { version: "v1", dev: ["librechat#1"], test: ["librechat#2", "librechat#3"] },
    ],
    [
      "an id is in both parts",
      { version: "v1", dev: ["librechat#1"], test: ["librechat#1", "librechat#2"] },
    ],
  ])("refuses a stale split where %s", (_, split) => {
    expect(() => splitPart(split, items, "dev")).toThrow("pnpm eval:split");
  });
});

describe("the committed split", () => {
  const items = loadEvalItems();
  const split = readSplit();

  it("is what `pnpm eval:split` builds from the committed data", () => {
    expect(readFileSync(SPLIT_FILE, "utf8")).toBe(serializeSplit(buildSplit(items, loadMirrors())));
  });

  it("gives dev every type, enough duplicates and enough injections", () => {
    expect(() => checkSplit(split, items)).not.toThrow();
    expect(
      new Set(items.filter(({ id }) => split.dev.includes(id)).map(({ gold }) => gold.type)),
    ).toEqual(new Set(TICKET_TYPES));
  });

  it("keeps every mirror pair and every duplicate with its original", () => {
    const pairs = [
      ...loadMirrors(),
      ...items.flatMap(({ id, gold }) =>
        gold.duplicateOf ? [[id, gold.duplicateOf] as const] : [],
      ),
    ];

    expect(pairs.filter(([a, b]) => partOf(split, a) !== partOf(split, b))).toEqual([]);
  });

  it("puts about a third of the items in dev", () => {
    expect(split.dev.length / items.length).toBeCloseTo(1 / 3, 1);
  });
});
