import { describe, expect, it } from "vitest";

import type { TriageContext } from "@/lib/policy";
import type { Policy } from "@/lib/policy-schema";

import { triage } from "@/lib/policy";
import { DEFAULT_POLICY } from "@/lib/policy-schema";
import { goldLevel } from "@/lib/priorities";

import type { AnswerOverrides } from "../../support/answers";

import { answers } from "../../support/answers";

const ctx = (overrides: Partial<TriageContext> = {}): TriageContext => ({
  plan: "business",
  spikeActive: false,
  demand: { workspaces: 0, arr: 0 },
  ...overrides,
});

const YES = 0.9;

function run(
  overrides: AnswerOverrides,
  context: Partial<TriageContext> = {},
  policy: Policy = DEFAULT_POLICY,
) {
  return triage(answers(overrides), ctx(context), policy);
}

describe("triage rules", () => {
  it.each<[string, AnswerOverrides, Partial<TriageContext>, string, string]>([
    [
      "data exposure on any type",
      { type: "question", dataExposure: YES },
      {},
      "urgent",
      "data_exposure",
    ],
    [
      "data loss on any type",
      { type: "feature_request", dataLoss: YES },
      {},
      "urgent",
      "data_loss",
    ],
    ["an active spike", { type: "other" }, { spikeActive: true }, "urgent", "spike"],
    ["a question", { type: "question" }, {}, "low", "question"],
    [
      "a question asking for a non-goal",
      { type: "question", nonGoals: { self_hosting: YES } },
      {},
      "wont_do",
      "non_goal",
    ],
    [
      "a feature request for a non-goal",
      { type: "feature_request", nonGoals: { media_generation: YES } },
      { demand: { workspaces: 50, arr: 9e6 } },
      "wont_do",
      "non_goal",
    ],
    [
      "a feature request with high workspace demand",
      { type: "feature_request" },
      { demand: { workspaces: 8, arr: 0 } },
      "high",
      "feature_demand_high",
    ],
    [
      "a feature request with high ARR demand",
      { type: "feature_request" },
      { demand: { workspaces: 1, arr: 500_000 } },
      "high",
      "feature_demand_high",
    ],
    [
      "a feature request with medium demand",
      { type: "feature_request" },
      { demand: { workspaces: 3, arr: 0 } },
      "medium",
      "feature_demand_medium",
    ],
    ["a feature request without demand", { type: "feature_request" }, {}, "low", "feature_request"],
    [
      "a bug blocking the whole workspace without workaround",
      { reach: "whole_workspace", blocked: YES },
      {},
      "high",
      "bug_widespread_blocking",
    ],
    [
      "a bug blocking several customers without workaround",
      { reach: "multiple_customers", blocked: YES },
      {},
      "high",
      "bug_widespread_blocking",
    ],
    [
      "a widespread blocking bug with a workaround",
      { reach: "whole_workspace", blocked: YES, workaround: YES },
      {},
      "medium",
      "bug_blocked",
    ],
    ["a bug blocking one user", { blocked: YES }, {}, "medium", "bug_blocked"],
    ["a regression", { regression: YES }, {}, "medium", "bug_regression"],
    ["any other bug", {}, {}, "low", "bug"],
    [
      "a billing matter that blocks the customer",
      { type: "account_billing", blocked: YES },
      {},
      "high",
      "billing_blocked",
    ],
    ["any other billing matter", { type: "account_billing" }, {}, "low", "billing"],
    ["a ticket without a request", { type: "other" }, {}, "low", "other"],
  ])("%s", (_, overrides, context, priority, rule) => {
    const result = run(overrides, context);

    expect([result.priority, result.ruleFired]).toEqual([priority, rule]);
  });

  it("checks data exposure, then data loss, then the spike, before the type", () => {
    const result = run(
      { type: "question", dataExposure: YES, dataLoss: YES },
      { spikeActive: true },
    );

    expect(result.ruleFired).toBe("data_exposure");
    expect(run({ type: "question", dataLoss: YES }, { spikeActive: true }).ruleFired).toBe(
      "data_loss",
    );
  });

  it("checks the non-goal before demand", () => {
    expect(
      run(
        { type: "feature_request", nonGoals: { self_hosting: YES } },
        { demand: { workspaces: 99, arr: 0 } },
      ).priority,
    ).toBe("wont_do");
  });

  it("ignores non-goals for bugs", () => {
    expect(run({ nonGoals: { self_hosting: YES } }).ruleFired).toBe("bug");
  });

  it("counts a yes/no answer as yes from the policy's threshold", () => {
    const strict: Policy = { ...DEFAULT_POLICY, yesThreshold: 0.8 };

    expect(run({ blocked: 0.7 }).ruleFired).toBe("bug_blocked");
    expect(run({ blocked: 0.7 }, {}, strict).ruleFired).toBe("bug");
  });

  it("traces each rule it checked, stopping each rule at its first failed condition", () => {
    const { trace } = run({ reach: "one_user", blocked: YES });

    expect(trace.map(({ rule, matched }) => `${rule}:${matched}`)).toEqual([
      "data_exposure:false",
      "data_loss:false",
      "spike:false",
      "bug_widespread_blocking:false",
      "bug_blocked:true",
    ]);
    expect(trace[3]?.checks).toEqual([{ name: "reach", value: "one_user", passed: false }]);
    expect(trace[4]?.checks).toEqual([{ name: "blocked", value: YES, needs: "yes", passed: true }]);
  });
});

describe("routing", () => {
  it.each<[AnswerOverrides, string]>([
    [{ type: "bug", area: "workflows" }, "automation"],
    [{ type: "feature_request", area: "admin_sso" }, "identity"],
    [{ type: "question", area: "agents" }, "support"],
    [{ type: "account_billing", area: "api" }, "billing"],
    [{ type: "other", area: "chat" }, "support"],
    [{ type: "bug", area: "chat", dataExposure: YES }, "chat"],
  ])("routes %o to %s", (overrides, squad) => {
    expect(run(overrides).squad).toBe(squad);
  });
});

describe("the Enterprise raise", () => {
  const raising: Policy = { ...DEFAULT_POLICY, enterpriseRaisesOneLevel: true };
  const enterprise = { plan: "enterprise" } as const;

  it.each<[string, AnswerOverrides, Partial<TriageContext>, string]>([
    ["Low to Medium", {}, {}, "medium"],
    ["Medium to High", { blocked: YES }, {}, "high"],
    ["High stays High", { type: "account_billing", blocked: YES }, {}, "high"],
    ["Urgent stays Urgent", { dataLoss: YES }, {}, "urgent"],
    [
      "Won't do stays Won't do",
      { type: "question", nonGoals: { self_hosting: YES } },
      {},
      "wont_do",
    ],
  ])("raises %s", (_, overrides, context, priority) => {
    expect(run(overrides, { ...context, ...enterprise }, raising).priority).toBe(priority);
  });

  it("keeps the rule that fired and traces the raise", () => {
    const result = run({}, enterprise, raising);

    expect(result.ruleFired).toBe("bug");
    expect(result.trace.at(-1)).toEqual({
      rule: "enterprise_raise",
      matched: true,
      checks: [{ name: "plan", value: "enterprise", passed: true }],
    });
  });

  it("applies only to Enterprise workspaces and only when the policy says so", () => {
    expect(run({}, { plan: "business" }, raising).priority).toBe("low");
    expect(run({}, enterprise).priority).toBe("low");
  });
});

describe("review reasons", () => {
  it("needs no review when every answer is clear", () => {
    expect(run({})).toMatchObject({ needsReview: false, reviewReasons: [] });
  });

  it.each<[string, AnswerOverrides, string]>([
    ["a low type probability", { type: ["bug", 0.5] }, "low_type_probability"],
    [
      "a low area probability when the area routes",
      { type: "bug", area: ["chat", 0.4] },
      "low_area_probability",
    ],
    ["a deciding answer in the band", { blocked: 0.5 }, "uncertain_deciding_answer"],
    ["a deciding no in the band", { dataExposure: 0.4 }, "uncertain_deciding_answer"],
    ["a flagged injection", { injection: 0.8 }, "injection_flagged"],
    [
      "an ambiguous duplicate match",
      {
        duplicate: {
          choice: "c1",
          probability: 0.45,
          probabilities: { c1: 0.45, none: 0.55 },
          issueId: "librechat#1",
        },
      },
      "ambiguous_duplicate",
    ],
  ])("sends %s to review", (_, overrides, reason) => {
    expect(run(overrides)).toMatchObject({ needsReview: true, reviewReasons: [reason] });
  });

  it("ignores a low area probability when the type routes the ticket", () => {
    expect(run({ type: "question", area: ["chat", 0.2] }).reviewReasons).toEqual([]);
  });

  it("ignores uncertainty on a branch that didn't decide the priority", () => {
    // A question never checks blocked, workaround or regression.
    expect(
      run({ type: "question", blocked: 0.5, workaround: 0.5, regression: 0.5 }).reviewReasons,
    ).toEqual([]);
    // Data exposure decided, so the bug ladder was never reached.
    expect(run({ dataExposure: YES, blocked: 0.5 }).reviewReasons).toEqual([]);
    // Narrow reach fails the High rule before blocked or workaround are checked there,
    // and a clear block then decides; the workaround is never checked.
    expect(run({ reach: "one_user", blocked: YES, workaround: 0.5 }).reviewReasons).toEqual([]);
  });

  it("uses the policy's band", () => {
    const narrow: Policy = { ...DEFAULT_POLICY, reviewBand: { low: 0.45, high: 0.55 } };

    expect(run({ blocked: 0.6 }, {}, narrow).reviewReasons).toEqual([]);
  });
});

describe("goldLevel", () => {
  it("maps Urgent and High to high, Medium to medium, and Low and Won't do to low", () => {
    expect((["urgent", "high", "medium", "low", "wont_do"] as const).map(goldLevel)).toEqual([
      "high",
      "high",
      "medium",
      "low",
      "low",
    ]);
  });
});
