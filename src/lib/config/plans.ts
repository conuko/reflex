// The plans a workspace can be on. The plan is a fact the model never sees; the
// policy may use it (ADR-0001).

export const PLANS = ["free", "business", "enterprise"] as const;

export type Plan = (typeof PLANS)[number];
