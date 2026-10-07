"use server";

import type { TriagePriority } from "@/lib/priorities";

import {
  acceptTriage,
  createIssue,
  linkIssue,
  setPriority,
  unlinkIssue,
} from "@/lib/commands/tickets";
import { db } from "@/lib/db";
import { publish } from "@/server/events";
import { queues } from "@/server/queues";

// Thin adapters over src/lib/commands/tickets.ts (plan M5): run the command,
// then tell every open inbox the ticket changed. Inputs are validated by the
// commands; there is no login (see "Deliberately not built" in the plan).

export async function setPriorityAction(ticketId: string, priority: TriagePriority) {
  const result = await setPriority({ db: db() }, { ticketId, priority });
  await publish({ type: "ticket", ticketId });
  return result;
}

export async function acceptAction(ticketId: string) {
  const result = await acceptTriage({ db: db() }, { ticketId });
  await publish({ type: "ticket", ticketId });
  return result;
}

export async function linkIssueAction(ticketId: string, issueId: string) {
  const result = await linkIssue({ db: db(), queues: queues() }, { ticketId, issueId });
  if (result.ok) await publish({ type: "ticket", ticketId });
  return result;
}

export async function unlinkIssueAction(ticketId: string, issueId: string) {
  const result = await unlinkIssue({ db: db(), queues: queues() }, { ticketId, issueId });
  await publish({ type: "ticket", ticketId });
  return result;
}

export async function createIssueAction(ticketId: string, title: string) {
  const result = await createIssue({ db: db(), queues: queues() }, { ticketId, title });
  if (result.ok) await publish({ type: "ticket", ticketId });
  return result;
}
