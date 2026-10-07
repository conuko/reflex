import type { Plan } from "@/lib/config/plans";
import type { Db } from "@/lib/db";
import type { TriagePriority } from "@/lib/priorities";
import type { Area, TicketType } from "@/lib/triage/questions";

import { PLANS } from "@/lib/config/plans";
import { TRIAGE_PRIORITIES } from "@/lib/priorities";
import { storedAnswers } from "@/lib/triage/context";

// The inbox list (plan M5): every ticket with the priority in force, a
// person's or the policy's, most pressing first. Served as JSON by
// /api/tickets, so dates are ISO strings.

export type InboxRow = {
  id: string;
  subject: string;
  source: string;
  createdAt: string;
  messageCount: number;
  workspace: { id: string; name: string; plan: Plan };
  /** The priority in force: a person's, else the policy's; `null` while the first triage runs. */
  priority: TriagePriority | null;
  /** The policy's priority. */
  suggested: TriagePriority | null;
  humanSet: boolean;
  accepted: boolean;
  ruleFired: string | null;
  needsReview: boolean;
  reviewReasons: string[];
  squad: string | null;
  type: TicketType | null;
  area: Area | null;
  linkedIssueIds: string[];
  /** Set when the policy's priority last changed, with the one before. */
  previousPriority: TriagePriority | null;
  priorityChangedAt: string | null;
  /** No triage yet, or the triage covers fewer messages than the ticket has. */
  triaging: boolean;
};

export type InboxData = {
  rows: InboxRow[];
  /** The policy in force, so the inbox can show what its save moved. */
  policy: { version: number; savedAt: string };
};

export const INBOX_LIMIT = 1_000;

const RANK = new Map<TriagePriority | null, number>([
  [null, -1],
  ...TRIAGE_PRIORITIES.map((priority, index) => [priority, index] as const),
]);

export async function listInbox(database: Db): Promise<InboxData> {
  const [tickets, policy] = await Promise.all([
    database.ticket.findMany({
      orderBy: { createdAt: "desc" },
      take: INBOX_LIMIT,
      include: {
        workspace: { select: { id: true, name: true, plan: true } },
        triage: { include: { judgment: { select: { answers: true } } } },
        links: { select: { issueId: true }, orderBy: { createdAt: "asc" } },
        messages: { select: { position: true } },
      },
    }),
    database.policy.findFirst({ orderBy: { version: "desc" } }),
  ]);

  const rows = tickets.map((ticket): InboxRow => {
    const { triage } = ticket;
    const answers = triage ? storedAnswers.parse(triage.judgment.answers) : null;
    const suggested = priorityOf(triage?.priority ?? null);
    const human = priorityOf(ticket.humanPriority);
    return {
      id: ticket.id,
      subject: ticket.subject,
      source: ticket.source,
      createdAt: ticket.createdAt.toISOString(),
      messageCount: ticket.messages.length,
      workspace: { ...ticket.workspace, plan: planOf(ticket.workspace.plan) },
      priority: human ?? suggested,
      suggested,
      humanSet: human !== null,
      accepted: ticket.acceptedAt !== null,
      ruleFired: triage?.ruleFired ?? null,
      needsReview: triage?.needsReview ?? false,
      reviewReasons: triage?.reviewReasons ?? [],
      squad: triage?.squad ?? null,
      type: answers?.type.choice ?? null,
      area: answers?.area.choice ?? null,
      linkedIssueIds: ticket.links.map(({ issueId }) => issueId),
      previousPriority: priorityOf(triage?.previousPriority ?? null),
      priorityChangedAt: triage?.priorityChangedAt?.toISOString() ?? null,
      triaging: !triage || triage.messageCount < ticket.messages.length,
    };
  });
  rows.sort(
    (a, b) =>
      (RANK.get(a.priority) ?? 0) - (RANK.get(b.priority) ?? 0) ||
      b.createdAt.localeCompare(a.createdAt),
  );

  return {
    rows,
    policy: {
      version: policy?.version ?? 1,
      savedAt: (policy?.createdAt ?? new Date(0)).toISOString(),
    },
  };
}

export function priorityOf(value: string | null): TriagePriority | null {
  return TRIAGE_PRIORITIES.find((priority) => priority === value) ?? null;
}

export function planOf(value: string): Plan {
  return PLANS.find((plan) => plan === value) ?? "free";
}
