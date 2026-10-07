import type { TraceStep } from "@/lib/policy";
import type { Policy } from "@/lib/policy-schema";

import {
  formatUsd,
  labelOf,
  PLAN_LABELS,
  REACH_LABELS,
  RULE_LABELS,
  signalLabel,
} from "@/lib/labels";

// "Why this priority" (plan M5): the policy's trace turned into rows the
// detail panel draws, from fixed templates. Nothing here is written by a
// model; Jev only supplied the probabilities.

export type ExplainedCheck = {
  label: string;
  /** For a yes/no answer: its probability of yes, the answer the rule needs, and the yes threshold. */
  bar: { probability: number; needs: "yes" | "no"; threshold: number } | null;
  /** The value in words, e.g. "82% yes" or "3 workspaces, $430k ARR". */
  detail: string;
  passed: boolean;
  /** A deciding yes/no answer inside the policy's review band. */
  uncertain: boolean;
};

export type ExplainedStep = {
  rule: TraceStep["rule"];
  title: string;
  matched: boolean;
  /** The rule that set the priority, or an Enterprise raise that applied. */
  decisive: boolean;
  checks: ExplainedCheck[];
};

const DEMAND = /^(\d+) workspaces, ARR (\d+(?:\.\d+)?)$/;

export function percent(probability: number): string {
  return `${Math.round(probability * 100)}%`;
}

export function explainTrace(trace: readonly TraceStep[], policy: Policy): ExplainedStep[] {
  return trace.map((step) => ({
    rule: step.rule,
    title: RULE_LABELS[step.rule],
    matched: step.matched,
    decisive: step.matched,
    checks: step.checks.map((check) => {
      if (check.needs !== undefined && typeof check.value === "number") {
        const { low, high } = policy.reviewBand;
        return {
          label: signalLabel(check.name),
          bar: { probability: check.value, needs: check.needs, threshold: policy.yesThreshold },
          detail: `${percent(check.value)} yes, needs ${check.needs}`,
          passed: check.passed,
          uncertain: check.value >= low && check.value <= high,
        };
      }
      return {
        label: signalLabel(check.name),
        bar: null,
        detail: factDetail(check.name, check.value, step.rule, policy),
        passed: check.passed,
        uncertain: false,
      };
    }),
  }));
}

function factDetail(
  name: string,
  value: number | string | boolean,
  rule: TraceStep["rule"],
  policy: Policy,
): string {
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (name === "reach") return labelOf(REACH_LABELS, String(value));
  if (name === "plan") return labelOf(PLAN_LABELS, String(value));
  if (name === "demand") {
    const match = DEMAND.exec(String(value));
    if (!match) return String(value);
    const { featureDemand: t } = policy;
    const [workspaces, arr] =
      rule === "feature_demand_high"
        ? [t.highWorkspaces, t.highArr]
        : [t.mediumWorkspaces, t.mediumArr];
    return `${match[1]} workspaces, ${formatUsd(Number(match[2]))} ARR; needs ${workspaces} workspaces or ${formatUsd(arr)}`;
  }
  return String(value);
}
