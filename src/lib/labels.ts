import type { Plan } from "@/lib/config/plans";
import type { Squad } from "@/lib/config/squads";
import type { ReviewReason, RuleId } from "@/lib/policy";
import type { TriagePriority } from "@/lib/priorities";
import type { Area, Reach, TicketType } from "@/lib/triage/questions";

import { NON_GOALS } from "@/lib/config/non-goals";

// What the app calls each value, in one place. Plain data with type-only
// imports, so client components can use it without pulling in the question
// set (which needs Node).

export const PRIORITY_LABELS: Record<TriagePriority, string> = {
  urgent: "Urgent",
  high: "High",
  medium: "Medium",
  low: "Low",
  wont_do: "Won't do",
};

/** The key that sets each priority in the inbox. */
export const PRIORITY_KEYS: Record<TriagePriority, string> = {
  urgent: "1",
  high: "2",
  medium: "3",
  low: "4",
  wont_do: "5",
};

export const TYPE_LABELS: Record<TicketType, string> = {
  bug: "Bug",
  feature_request: "Feature request",
  question: "Question",
  account_billing: "Account or billing",
  other: "Other",
};

export const AREA_LABELS: Record<Area, string> = {
  chat: "Chat",
  agents: "Agents",
  workflows: "Workflows",
  knowledge_library: "Knowledge library",
  integrations: "Integrations",
  models: "Models",
  admin_sso: "Admin and SSO",
  api: "API",
  other: "Other",
};

export const REACH_LABELS: Record<Reach, string> = {
  one_user: "One user",
  one_team: "One team",
  whole_workspace: "The whole workspace",
  multiple_customers: "Several customers",
  not_stated: "Not stated",
};

/** Frustration levels 0 to 4, as the score question describes them. */
export const FRUSTRATION_LABELS = [
  "Calm",
  "Mildly impatient",
  "Clearly frustrated",
  "Angry",
  "Threatening to leave",
] as const;

export const SQUAD_LABELS: Record<Squad, string> = {
  support: "Support",
  billing: "Billing",
  chat: "Chat",
  agents: "Agents",
  automation: "Automation",
  knowledge: "Knowledge",
  platform: "Platform",
  identity: "Identity",
};

export const PLAN_LABELS: Record<Plan, string> = {
  free: "Free",
  business: "Business",
  enterprise: "Enterprise",
};

/** Each rule as a sentence: what it checks and what it decides. */
export const RULE_LABELS: Record<RuleId | "enterprise_raise", string> = {
  data_exposure: "Customer data may be exposed: Urgent",
  data_loss: "Customer data may be lost: Urgent",
  spike: "Part of an open incident: Urgent",
  non_goal: "Asks for something we won't build: Won't do",
  question: "A question: Low",
  feature_demand_high: "A feature request with high demand: High",
  feature_demand_medium: "A feature request with some demand: Medium",
  feature_request: "A feature request: Low",
  bug_widespread_blocking: "A bug that blocks many users with no workaround: High",
  bug_blocked: "A bug that blocks the customer: Medium",
  bug_regression: "A bug in something that used to work: Medium",
  bug: "A bug: Low",
  billing_blocked: "A billing matter that blocks the customer: High",
  billing: "A billing matter: Low",
  other: "Anything else: Low",
  enterprise_raise: "Enterprise workspaces go up one level, up to High",
};

export const REVIEW_REASON_LABELS: Record<ReviewReason, string> = {
  low_type_probability: "Jev isn't sure of the type",
  low_area_probability: "Jev isn't sure of the area",
  uncertain_deciding_answer: "An answer that decided the priority is uncertain",
  injection_flagged: "The ticket may try to instruct the triage",
  ambiguous_duplicate: "The duplicate match is uncertain",
};

/** The signals the inbox shows, by the name the policy's trace uses. */
export const SIGNAL_LABELS: Record<string, string> = {
  blocked: "Blocked",
  workaround: "Has a workaround",
  regression: "Used to work",
  data_exposure: "Data exposure",
  dataExposure: "Data exposure",
  data_loss: "Data loss",
  dataLoss: "Data loss",
  injection: "Tries to instruct the triage",
  reach: "Reach",
  spike: "Open incident",
  demand: "Demand on the linked issue",
  plan: "Workspace plan",
  type: "Type",
  area: "Area",
  duplicate: "Duplicate of",
  frustration: "Frustration",
};

export const NON_GOAL_LABELS: Record<string, string> = {
  self_hosting: "Self-hosting",
  native_mobile_apps: "Native mobile apps",
  media_generation: "Media generation",
};

export function nonGoalLabel(id: string): string {
  return NON_GOAL_LABELS[id] ?? id;
}

/** A check's or a signal's label; `non_goal:<id>` names the non-goal. */
export function signalLabel(name: string): string {
  if (name.startsWith("non_goal:"))
    return `Asks for: ${nonGoalLabel(name.slice("non_goal:".length))}`;
  if (name.startsWith("nonGoal:"))
    return `Asks for: ${nonGoalLabel(name.slice("nonGoal:".length))}`;
  return SIGNAL_LABELS[name] ?? name;
}

export function labelOf<K extends string>(labels: Record<K, string>, value: string | null): string {
  if (value === null) return "None";
  const byValue: Record<string, string> = labels;
  return byValue[value] ?? value;
}

/** Every non-goal with its label and description, for the demand page. */
export const NON_GOAL_DESCRIPTIONS = NON_GOALS.map(({ id, what }) => ({
  id,
  label: nonGoalLabel(id),
  what,
}));

export function formatUsd(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${Math.round(value / 1_000)}k`;
  return `$${value}`;
}
