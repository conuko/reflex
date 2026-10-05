// The go/no-go gate (plan M3), fixed before the test run and frozen with the
// question set in one commit. Each check names what the app does instead if it
// fails, so a failure changes behavior rather than inviting another round of
// tuning on test. Accuracy and "beats the keyword rules" are separate checks
// with separate fallbacks: a baseline that is about as good is a finding for
// the README, not a reason to send every ticket to review.

export const GATE_VERSION = "v1";

export type GateCheckId =
  | "type_accuracy"
  | "type_vs_keywords"
  | "area_accuracy"
  | "area_vs_keywords"
  | "duplicate_pick"
  | "false_match_rate"
  | "duplicate_vs_search"
  | "injection";

export type GateCheck = {
  id: GateCheckId;
  criterion: string;
  /** What the app does if the check fails on test. */
  fallback: string;
  /** Small n: reported, but read with care. */
  directional: boolean;
};

export const GATE_CHECKS: readonly GateCheck[] = [
  {
    id: "type_accuracy",
    criterion: "type accuracy ≥ 0.80",
    fallback: "Every triage needs review.",
    directional: false,
  },
  {
    id: "type_vs_keywords",
    criterion: "the 95% interval of Jev − keyword rules for type lies above 0",
    fallback:
      "The README says plain keyword rules find the type about as well; the app is unchanged.",
    directional: false,
  },
  {
    id: "area_accuracy",
    criterion: "area accuracy ≥ 0.60",
    fallback: "Every triage needs review.",
    directional: false,
  },
  {
    id: "area_vs_keywords",
    criterion: "the 95% interval of Jev − keyword rules for area lies above 0",
    fallback: "The README says plain keyword rules route about as well; the app is unchanged.",
    directional: false,
  },
  {
    id: "duplicate_pick",
    criterion: "duplicate pick accuracy ≥ 0.60 when the original is among the candidates",
    fallback: "The app shows candidates but never links one automatically.",
    directional: true,
  },
  {
    id: "false_match_rate",
    criterion: "false-match rate ≤ 0.10 on tickets that duplicate nothing",
    fallback: "The app shows candidates but never links one automatically.",
    directional: false,
  },
  {
    id: "duplicate_vs_search",
    criterion: "duplicate hit rate ≥ the search's top hit at the same false-match rate",
    fallback: "The app shows candidates but never links one automatically.",
    directional: true,
  },
  {
    id: "injection",
    criterion: "injection recall ≥ 0.80 with a false-positive rate ≤ 0.10",
    fallback: "The README lists injection detection under known failure modes.",
    directional: true,
  },
];

export const GATE_THRESHOLDS = {
  typeAccuracy: 0.8,
  areaAccuracy: 0.6,
  duplicatePick: 0.6,
  falseMatchRate: 0.1,
  injectionRecall: 0.8,
  injectionFalsePositiveRate: 0.1,
} as const;
