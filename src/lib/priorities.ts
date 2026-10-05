// The priorities a triage can get, most pressing first (ADR-0001). Gold labels
// use three levels instead (`PRIORITIES` in src/lib/issue-corpus.ts); the eval
// maps Urgent and High to high, Medium to medium, and Low and Won't do to low.

export const TRIAGE_PRIORITIES = ["urgent", "high", "medium", "low", "wont_do"] as const;

export type TriagePriority = (typeof TRIAGE_PRIORITIES)[number];

/** The three-level gold label a triage priority is compared with. */
export function goldLevel(priority: TriagePriority): "high" | "medium" | "low" {
  if (priority === "urgent" || priority === "high") return "high";
  return priority === "medium" ? "medium" : "low";
}
