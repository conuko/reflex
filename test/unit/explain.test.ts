import { describe, expect, it } from "vitest";

import { triage } from "@/lib/policy";
import { DEFAULT_POLICY } from "@/lib/policy-schema";
import { explainTrace } from "@/lib/triage/explain";

import { answers } from "../support/answers";

const business = {
  plan: "business",
  spikeActive: false,
  demand: { workspaces: 0, arr: 0 },
} as const;

describe("explainTrace", () => {
  it("draws a bar for each yes/no answer and marks the rule that fired", () => {
    const { trace } = triage(answers({ dataLoss: 0.82 }), business, DEFAULT_POLICY);

    const steps = explainTrace(trace, DEFAULT_POLICY);

    expect(steps.map(({ rule, decisive }) => [rule, decisive])).toEqual([
      ["data_exposure", false],
      ["data_loss", true],
    ]);
    expect(steps[1]).toMatchObject({
      title: "Customer data may be lost: Urgent",
      checks: [
        {
          label: "Data loss",
          bar: { probability: 0.82, needs: "yes", threshold: 0.5 },
          detail: "82% yes, needs yes",
          passed: true,
          uncertain: false,
        },
      ],
    });
  });

  it("flags a deciding answer inside the review band as uncertain", () => {
    const { trace } = triage(answers({ blocked: 0.6 }), business, DEFAULT_POLICY);

    const blocked = explainTrace(trace, DEFAULT_POLICY)
      .flatMap(({ checks }) => checks)
      .find(({ label }) => label === "Blocked");

    expect(blocked).toMatchObject({ passed: true, uncertain: true });
  });

  it("writes facts in words: reach, the open incident, demand against its threshold", () => {
    const wide = triage(
      answers({ reach: "whole_workspace", blocked: 0.9 }),
      business,
      DEFAULT_POLICY,
    );
    const feature = triage(
      answers({ type: "feature_request" }),
      { ...business, demand: { workspaces: 3, arr: 430_000 } },
      DEFAULT_POLICY,
    );

    const details = (trace: typeof wide.trace) =>
      explainTrace(trace, DEFAULT_POLICY).flatMap(({ checks }) =>
        checks.map(({ detail }) => detail),
      );

    expect(details(wide.trace)).toContain("The whole workspace");
    expect(details(wide.trace)).toContain("no");
    expect(details(feature.trace)).toContain(
      "3 workspaces, $430k ARR; needs 8 workspaces or $500k",
    );
    expect(details(feature.trace)).toContain(
      "3 workspaces, $430k ARR; needs 3 workspaces or $100k",
    );
  });
});
