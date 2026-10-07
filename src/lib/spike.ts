import type { Answers } from "@/lib/triage/parse-judgment";

// Spike detection (plan M4): a burst of related tickets becomes an incident,
// and while it's open the policy makes the group's tickets Urgent. Jev
// doesn't count or compare dates reliably, so all of that is code; Jev only
// decides which tickets are related, through its duplicate pick or the area.

export const SPIKE_RULES = {
  /** Tickets are counted over the last this many minutes; incidents are keyed by the aligned window. */
  windowMinutes: 30,
  /** This many related tickets in the window make a spike. */
  minTickets: 5,
} as const;

export type SpikeRules = { windowMinutes: number; minTickets: number };

/** Tickets that duplicate the same issue belong together; otherwise tickets of the same area in a tracker. */
export function groupKey(answers: Pick<Answers, "duplicate" | "area">, tracker: string): string {
  const issueId = answers.duplicate?.issueId;
  return issueId ? `issue:${issueId}` : `area:${tracker}:${answers.area.choice}`;
}

export type GroupedTicket = { ticketId: string; groupKey: string; createdAt: Date };
export type Spike = { groupKey: string; windowStart: Date; ticketIds: string[] };

/** The groups with at least `minTickets` tickets created in the window up to `now`. */
export function detectSpikes(
  tickets: readonly GroupedTicket[],
  now: Date,
  rules: SpikeRules = SPIKE_RULES,
): Spike[] {
  const windowMs = rules.windowMinutes * 60_000;
  const from = now.getTime() - windowMs;
  const windowStart = new Date(Math.floor(now.getTime() / windowMs) * windowMs);

  const groups = new Map<string, string[]>();
  for (const { ticketId, groupKey: key, createdAt } of tickets) {
    const at = createdAt.getTime();
    if (at <= from || at > now.getTime()) continue;
    groups.set(key, [...(groups.get(key) ?? []), ticketId]);
  }
  return [...groups]
    .filter(([, ids]) => ids.length >= rules.minTickets)
    .map(([key, ids]) => ({ groupKey: key, windowStart, ticketIds: ids.toSorted() }))
    .toSorted((a, b) => (a.groupKey < b.groupKey ? -1 : 1));
}
