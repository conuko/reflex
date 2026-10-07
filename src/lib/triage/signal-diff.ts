import type { Answers } from "./parse-judgment";

// What changed between two judgments of the same ticket (plan M5, Try it):
// after a reply, which of Jev's answers moved. Pure, so it's unit-tested and
// the page only draws the result.
//
// A choice changes when the chosen option changes. A yes/no answer changes
// when it crosses the yes threshold, or when its probability moves by at
// least `minShift` without crossing (shown as more or less likely).

export type SignalChange =
  | {
      kind: "choice";
      signal: "type" | "area" | "reach";
      from: string;
      to: string;
      fromProbability: number;
      toProbability: number;
    }
  | {
      kind: "yes_no";
      /** `blocked`, `dataLoss`, …, or `nonGoal:<id>`. */
      signal: string;
      from: number;
      to: number;
      /** The answer it crossed into, or `null` when it only moved. */
      became: "yes" | "no" | null;
    }
  | { kind: "duplicate"; signal: "duplicate"; from: string | null; to: string | null }
  | { kind: "frustration"; signal: "frustration"; from: number; to: number };

export const DEFAULT_MIN_SHIFT = 0.2;

const YES_NO = [
  "blocked",
  "workaround",
  "regression",
  "dataExposure",
  "dataLoss",
  "injection",
] as const;

export function diffSignals(
  before: Answers,
  after: Answers,
  { yesThreshold, minShift = DEFAULT_MIN_SHIFT }: { yesThreshold: number; minShift?: number },
): SignalChange[] {
  const changes: SignalChange[] = [];

  for (const signal of ["type", "area", "reach"] as const) {
    const [from, to] = [before[signal], after[signal]];
    if (from.choice !== to.choice) {
      changes.push({
        kind: "choice",
        signal,
        from: from.choice,
        to: to.choice,
        fromProbability: from.probability,
        toProbability: to.probability,
      });
    }
  }

  const yesNo = (signal: string, from: number, to: number) => {
    const [wasYes, isYes] = [from >= yesThreshold, to >= yesThreshold];
    if (wasYes !== isYes)
      changes.push({ kind: "yes_no", signal, from, to, became: isYes ? "yes" : "no" });
    else if (Math.abs(to - from) >= minShift)
      changes.push({ kind: "yes_no", signal, from, to, became: null });
  };
  for (const signal of YES_NO) yesNo(signal, before[signal], after[signal]);
  const nonGoals = new Set([...Object.keys(before.nonGoals), ...Object.keys(after.nonGoals)]);
  for (const id of [...nonGoals].toSorted()) {
    yesNo(`nonGoal:${id}`, before.nonGoals[id] ?? 0, after.nonGoals[id] ?? 0);
  }

  const [fromIssue, toIssue] = [
    before.duplicate?.issueId ?? null,
    after.duplicate?.issueId ?? null,
  ];
  if (fromIssue !== toIssue) {
    changes.push({ kind: "duplicate", signal: "duplicate", from: fromIssue, to: toIssue });
  }

  const [calm, upset] = [Math.round(before.frustration.score), Math.round(after.frustration.score)];
  if (calm !== upset) {
    changes.push({ kind: "frustration", signal: "frustration", from: calm, to: upset });
  }
  return changes;
}
