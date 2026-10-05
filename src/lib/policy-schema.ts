import { z } from "zod";

// The editable part of the priority policy (ADR-0001): thresholds and
// switches, never rules. A zod schema, so the policy editor (plan M5) gets
// field-level errors for free. Changing a value here needs only a new policy
// version and a recompute; changing what a question means needs a new
// question-set version.

const probability = z.number().min(0).max(1);

export const policySchema = z
  .object({
    /** A yes/no answer counts as yes at or above this probability. */
    yesThreshold: probability,
    /** A yes/no answer that decided the priority and falls in this band sends the ticket to review. */
    reviewBand: z
      .object({ low: probability, high: probability })
      .strict()
      .refine(({ low, high }) => low < high, { message: "low must be below high", path: ["low"] }),
    /** Below this probability of the chosen type, the ticket goes to review. */
    minTypeProbability: probability,
    /** Below this probability of the chosen area, the ticket goes to review when the area decides its squad. */
    minAreaProbability: probability,
    /** Below this probability of the duplicate answer, the match counts as ambiguous. */
    minDuplicateProbability: probability,
    /** Feature requests with this much demand are raised to Medium or High. */
    featureDemand: z
      .object({
        mediumWorkspaces: z.int().min(1),
        highWorkspaces: z.int().min(1),
        mediumArr: z.number().min(0),
        highArr: z.number().min(0),
      })
      .strict()
      .refine(({ mediumWorkspaces, highWorkspaces }) => mediumWorkspaces <= highWorkspaces, {
        message: "must not be above highWorkspaces",
        path: ["mediumWorkspaces"],
      })
      .refine(({ mediumArr, highArr }) => mediumArr <= highArr, {
        message: "must not be above highArr",
        path: ["mediumArr"],
      }),
    /** Enterprise tickets go up one level, capped at High and never from Won't do. */
    enterpriseRaisesOneLevel: z.boolean(),
  })
  .strict();

export type Policy = z.infer<typeof policySchema>;

/** Policy v1. M3 revisits the review thresholds against the calibration curve. */
export const DEFAULT_POLICY: Policy = {
  yesThreshold: 0.5,
  reviewBand: { low: 0.35, high: 0.65 },
  minTypeProbability: 0.6,
  minAreaProbability: 0.5,
  minDuplicateProbability: 0.6,
  featureDemand: { mediumWorkspaces: 3, highWorkspaces: 8, mediumArr: 100_000, highArr: 500_000 },
  enterpriseRaisesOneLevel: false,
};
