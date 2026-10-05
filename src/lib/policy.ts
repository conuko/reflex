import type { Plan } from "@/lib/config/plans";
import type { Squad } from "@/lib/config/squads";
import type { Policy } from "@/lib/policy-schema";
import type { TriagePriority } from "@/lib/priorities";
import type { Answers } from "@/lib/triage/parse-judgment";
import type { TicketType } from "@/lib/triage/questions";

import { routesByArea, squadFor } from "@/lib/config/squads";

// The model judges, the policy decides (ADR-0001). `triage` turns one
// judgment's answers plus facts the model never sees (plan, spike, demand)
// into a priority, a squad and review reasons. Pure: no I/O, no model calls,
// so a policy change recomputes every ticket from stored judgments.
//
// Rules, first match wins: data exposure, data loss or a spike make any
// ticket Urgent; then the ticket's type picks a ladder. A rule checks its
// conditions in order and stops at the first that fails, and the trace
// records exactly what was checked. Only answers that were checked can send
// a ticket to review: uncertainty on branches that didn't decide is ignored.

export type TriageContext = {
  plan: Plan;
  spikeActive: boolean;
  /** Demand on the issue the ticket is linked to: distinct workspaces and their combined ARR. */
  demand: { workspaces: number; arr: number };
};

export const RULE_IDS = [
  "data_exposure",
  "data_loss",
  "spike",
  "non_goal",
  "question",
  "feature_demand_high",
  "feature_demand_medium",
  "feature_request",
  "bug_widespread_blocking",
  "bug_blocked",
  "bug_regression",
  "bug",
  "billing_blocked",
  "billing",
  "other",
] as const;

export type RuleId = (typeof RULE_IDS)[number];

export const REVIEW_REASONS = [
  "low_type_probability",
  "low_area_probability",
  "uncertain_deciding_answer",
  "injection_flagged",
  "ambiguous_duplicate",
] as const;

export type ReviewReason = (typeof REVIEW_REASONS)[number];

/** One condition a rule checked. A yes/no answer's value is its probability of yes. */
export type Check = {
  name: string;
  value: number | string | boolean;
  /** For yes/no answers: the answer the rule needs. */
  needs?: "yes" | "no";
  passed: boolean;
};

export type TraceStep = { rule: RuleId | "enterprise_raise"; matched: boolean; checks: Check[] };

export type TriageResult = {
  priority: TriagePriority;
  /** The rule that set the priority, before any Enterprise raise. */
  ruleFired: RuleId;
  needsReview: boolean;
  reviewReasons: ReviewReason[];
  squad: Squad;
  trace: TraceStep[];
};

type Rule = { id: RuleId; priority: TriagePriority; checks: (() => Check)[] };

const WIDE_REACH = new Set(["whole_workspace", "multiple_customers"]);

/** A condition on a fact from code, or on a choice answer. */
function fact(name: string, value: string | boolean, passed: boolean): () => Check {
  return () => ({ name, value, passed });
}

export function triage(answers: Answers, ctx: TriageContext, policy: Policy): TriageResult {
  const type = answers.type.choice;
  const isYes = (probability: number) => probability >= policy.yesThreshold;
  const yesNo = (name: string, probability: number, needs: "yes" | "no") => (): Check => ({
    name,
    value: probability,
    needs,
    passed: isYes(probability) === (needs === "yes"),
  });

  const [nonGoalId, nonGoalProbability] = Object.entries(answers.nonGoals).reduce<[string, number]>(
    (top, entry) => (entry[1] > top[1] ? entry : top),
    ["none", 0],
  );
  const { workspaces, arr } = ctx.demand;
  const demand = `${workspaces} workspaces, ARR ${arr}`;
  const { featureDemand: thresholds } = policy;

  const everyType: Rule[] = [
    {
      id: "data_exposure",
      priority: "urgent",
      checks: [yesNo("data_exposure", answers.dataExposure, "yes")],
    },
    { id: "data_loss", priority: "urgent", checks: [yesNo("data_loss", answers.dataLoss, "yes")] },
    { id: "spike", priority: "urgent", checks: [fact("spike", ctx.spikeActive, ctx.spikeActive)] },
  ];
  const nonGoal: Rule = {
    id: "non_goal",
    priority: "wont_do",
    checks: [yesNo(`non_goal:${nonGoalId}`, nonGoalProbability, "yes")],
  };
  const ladders: Record<TicketType, Rule[]> = {
    question: [nonGoal, { id: "question", priority: "low", checks: [] }],
    feature_request: [
      nonGoal,
      {
        id: "feature_demand_high",
        priority: "high",
        checks: [
          fact(
            "demand",
            demand,
            workspaces >= thresholds.highWorkspaces || arr >= thresholds.highArr,
          ),
        ],
      },
      {
        id: "feature_demand_medium",
        priority: "medium",
        checks: [
          fact(
            "demand",
            demand,
            workspaces >= thresholds.mediumWorkspaces || arr >= thresholds.mediumArr,
          ),
        ],
      },
      { id: "feature_request", priority: "low", checks: [] },
    ],
    bug: [
      {
        id: "bug_widespread_blocking",
        priority: "high",
        checks: [
          fact("reach", answers.reach.choice, WIDE_REACH.has(answers.reach.choice)),
          yesNo("blocked", answers.blocked, "yes"),
          yesNo("workaround", answers.workaround, "no"),
        ],
      },
      { id: "bug_blocked", priority: "medium", checks: [yesNo("blocked", answers.blocked, "yes")] },
      {
        id: "bug_regression",
        priority: "medium",
        checks: [yesNo("regression", answers.regression, "yes")],
      },
      { id: "bug", priority: "low", checks: [] },
    ],
    account_billing: [
      {
        id: "billing_blocked",
        priority: "high",
        checks: [yesNo("blocked", answers.blocked, "yes")],
      },
      { id: "billing", priority: "low", checks: [] },
    ],
    other: [{ id: "other", priority: "low", checks: [] }],
  };

  const trace: TraceStep[] = [];
  let fired: Rule | undefined;
  for (const rule of [...everyType, ...ladders[type]]) {
    const checks: Check[] = [];
    for (const check of rule.checks) {
      const result = check();
      checks.push(result);
      if (!result.passed) break;
    }
    const matched = checks.every(({ passed }) => passed);
    trace.push({ rule: rule.id, matched, checks });
    if (matched) {
      fired = rule;
      break;
    }
  }
  // Every ladder ends in a rule without conditions, so one always fires.
  if (!fired) throw new Error(`No rule fired for type ${type}`);

  let { priority } = fired;
  if (policy.enterpriseRaisesOneLevel) {
    const raised = raiseOneLevel(priority);
    const applies = ctx.plan === "enterprise" && raised !== priority;
    trace.push({
      rule: "enterprise_raise",
      matched: applies,
      checks: [{ name: "plan", value: ctx.plan, passed: ctx.plan === "enterprise" }],
    });
    if (applies) priority = raised;
  }

  const { reviewBand } = policy;
  const reasons: Record<ReviewReason, boolean> = {
    low_type_probability: answers.type.probability < policy.minTypeProbability,
    low_area_probability:
      routesByArea(type) && answers.area.probability < policy.minAreaProbability,
    uncertain_deciding_answer: trace.some(({ checks }) =>
      checks.some(
        ({ needs, value }) =>
          needs !== undefined &&
          typeof value === "number" &&
          value >= reviewBand.low &&
          value <= reviewBand.high,
      ),
    ),
    injection_flagged: isYes(answers.injection),
    ambiguous_duplicate:
      answers.duplicate !== null && answers.duplicate.probability < policy.minDuplicateProbability,
  };
  const reviewReasons = REVIEW_REASONS.filter((reason) => reasons[reason]);

  return {
    priority,
    ruleFired: fired.id,
    needsReview: reviewReasons.length > 0,
    reviewReasons,
    squad: squadFor(type, answers.area.choice),
    trace,
  };
}

// Low → Medium → High; High is the cap, and Urgent and Won't do stay as they are.
function raiseOneLevel(priority: TriagePriority): TriagePriority {
  if (priority === "low") return "medium";
  if (priority === "medium") return "high";
  return priority;
}
