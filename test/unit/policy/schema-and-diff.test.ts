import { describe, expect, it } from "vitest";

import type { TriageContext } from "@/lib/policy";
import type { PolicyRow } from "@/lib/recompute";

import { PLANS } from "@/lib/config/plans";
import { DEFAULT_POLICY, policySchema } from "@/lib/policy-schema";
import { diffPolicies } from "@/lib/recompute";

import { answers } from "../../support/answers";

describe("policySchema", () => {
  it("accepts the default policy", () => {
    expect(policySchema.parse(DEFAULT_POLICY)).toEqual(DEFAULT_POLICY);
  });

  it.each([
    ["yesThreshold", { yesThreshold: 1.2 }],
    ["reviewBand.low", { reviewBand: { low: 0.7, high: 0.6 } }],
    [
      "featureDemand.mediumWorkspaces",
      { featureDemand: { ...DEFAULT_POLICY.featureDemand, mediumWorkspaces: 9 } },
    ],
    [
      "featureDemand.mediumArr",
      { featureDemand: { ...DEFAULT_POLICY.featureDemand, mediumArr: 600_000 } },
    ],
    [
      "featureDemand.highWorkspaces",
      { featureDemand: { ...DEFAULT_POLICY.featureDemand, highWorkspaces: 2.5 } },
    ],
    ["enterpriseRaisesOneLevel", { enterpriseRaisesOneLevel: "yes" }],
  ])("reports an invalid %s at its field", (path, change) => {
    const result = policySchema.safeParse({ ...DEFAULT_POLICY, ...change });

    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.path.join("."))).toContain(path);
  });

  it("rejects unknown fields", () => {
    expect(policySchema.safeParse({ ...DEFAULT_POLICY, autoClose: true }).success).toBe(false);
  });
});

// 0: a Low bug, 1: a Medium bug, 2: a High bug. Independent of the plan, which cycles with i % 3.
const bugKind = (i: number) => Math.floor(i / 3) % 3;
// Enterprise rows (i % 3 === 2) that aren't human-set (i % 10 === 9) and aren't already High.
const EXPECTED_MOVES = 200;

describe("diffPolicies", () => {
  // 1,000 synthetic rows built so the moves are known: a third are Enterprise,
  // and the rest of each row's shape cycles through low, medium and high bugs.
  const rows: PolicyRow[] = Array.from({ length: 1_000 }, (_, i) => {
    const kind = bugKind(i);
    const overrides =
      kind === 0
        ? {}
        : kind === 1
          ? { blocked: 0.9 }
          : { reach: "whole_workspace" as const, blocked: 0.9 };
    const ctx: TriageContext = {
      plan: PLANS[i % PLANS.length] ?? "free",
      spikeActive: false,
      demand: { workspaces: 0, arr: 0 },
    };
    return {
      ticketId: `t${i}`,
      answers: answers(overrides),
      ctx,
      humanPriority: i % 10 === 9 ? "urgent" : null,
    };
  });
  const raising = { ...DEFAULT_POLICY, enterpriseRaisesOneLevel: true };

  it("lists exactly the rows a policy change moves", () => {
    const decided = rows.filter(({ humanPriority }) => humanPriority === null);
    const enterprise = decided.filter(({ ctx }) => ctx.plan === "enterprise");
    // Low and Medium bugs move up one level; High bugs are capped.
    const expected = enterprise.filter(({ ticketId }) => bugKind(Number(ticketId.slice(1))) !== 2);

    const diff = diffPolicies(rows, DEFAULT_POLICY, raising);

    expect(expected).toHaveLength(EXPECTED_MOVES);
    expect(diff.compared).toBe(decided.length);
    expect(diff.skippedHumanSet).toBe(100);
    expect(diff.moved.map(({ ticketId }) => ticketId)).toEqual(
      expected.map(({ ticketId }) => ticketId),
    );
    expect(diff.matrix.low.medium + diff.matrix.medium.high).toBe(expected.length);
  });

  it("counts every compared row in the matrix, unchanged rows on the diagonal", () => {
    const diff = diffPolicies(rows, DEFAULT_POLICY, DEFAULT_POLICY);
    const total = Object.values(diff.matrix).reduce(
      (sum, row) => sum + Object.values(row).reduce((a, b) => a + b, 0),
      0,
    );

    expect(diff.moved).toEqual([]);
    expect(total).toBe(diff.compared);
    expect(diff.matrix.low.low + diff.matrix.medium.medium + diff.matrix.high.high).toBe(
      diff.compared,
    );
  });

  it("never moves a ticket with a human-set priority", () => {
    const diff = diffPolicies(rows, DEFAULT_POLICY, raising);

    expect(diff.moved.filter(({ ticketId }) => Number(ticketId.slice(1)) % 10 === 9)).toEqual([]);
  });
});
