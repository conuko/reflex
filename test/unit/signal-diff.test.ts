import { describe, expect, it } from "vitest";

import { diffSignals } from "@/lib/triage/signal-diff";

import { answers } from "../support/answers";

const yesThreshold = 0.5;

/** A duplicate answer that picks `issueId`, or none. */
const pick = (issueId: string | null) => ({
  choice: issueId ? "c1" : "none",
  probability: 0.9,
  probabilities: { none: issueId ? 0.1 : 0.9, c1: issueId ? 0.9 : 0.1 },
  issueId,
});

describe("diffSignals", () => {
  it("finds nothing between identical answers", () => {
    expect(diffSignals(answers(), answers(), { yesThreshold })).toEqual([]);
  });

  it("reports a changed choice with both probabilities", () => {
    const changes = diffSignals(
      answers({ type: ["question", 0.7], area: "chat" }),
      answers({ type: ["bug", 0.95], area: "chat" }),
      { yesThreshold },
    );

    expect(changes).toEqual([
      {
        kind: "choice",
        signal: "type",
        from: "question",
        to: "bug",
        fromProbability: 0.7,
        toProbability: 0.95,
      },
    ]);
  });

  it("reports a yes/no answer that crosses the threshold, either way", () => {
    const changes = diffSignals(
      answers({ blocked: 0.2, workaround: 0.8 }),
      answers({ blocked: 0.9, workaround: 0.3 }),
      { yesThreshold },
    );

    expect(changes).toEqual([
      { kind: "yes_no", signal: "blocked", from: 0.2, to: 0.9, became: "yes" },
      { kind: "yes_no", signal: "workaround", from: 0.8, to: 0.3, became: "no" },
    ]);
  });

  it("reports a big move that doesn't cross as a move, and ignores a small one", () => {
    const changes = diffSignals(
      answers({ dataLoss: 0.05, regression: 0.1 }),
      answers({ dataLoss: 0.3, regression: 0.25 }),
      { yesThreshold },
    );

    expect(changes).toEqual([
      { kind: "yes_no", signal: "dataLoss", from: 0.05, to: 0.3, became: null },
    ]);
  });

  it("uses the policy's yes threshold", () => {
    const before = answers({ injection: 0.55 });
    const after = answers({ injection: 0.65 });

    expect(diffSignals(before, after, { yesThreshold })).toEqual([]);
    expect(diffSignals(before, after, { yesThreshold: 0.6 })).toEqual([
      { kind: "yes_no", signal: "injection", from: 0.55, to: 0.65, became: "yes" },
    ]);
  });

  it("reports non-goals by id", () => {
    const changes = diffSignals(
      answers(),
      answers({
        nonGoals: { self_hosting: 0.92, native_mobile_apps: 0.05, media_generation: 0.05 },
      }),
      { yesThreshold },
    );

    expect(changes).toEqual([
      { kind: "yes_no", signal: "nonGoal:self_hosting", from: 0.05, to: 0.92, became: "yes" },
    ]);
  });

  it("reports a new duplicate pick, and a changed frustration level", () => {
    const changes = diffSignals(
      answers({
        duplicate: pick(null),
        frustration: { score: 0.6, probabilities: [0.4, 0.6, 0, 0, 0] },
      }),
      answers({
        duplicate: pick("librechat#2104"),
        frustration: { score: 3.2, probabilities: [0, 0, 0.1, 0.6, 0.3] },
      }),
      { yesThreshold },
    );

    expect(changes).toEqual([
      { kind: "duplicate", signal: "duplicate", from: null, to: "librechat#2104" },
      { kind: "frustration", signal: "frustration", from: 1, to: 3 },
    ]);
  });
});
