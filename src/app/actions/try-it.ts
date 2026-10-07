"use server";

import { addTryItReply, simulateIncident, submitTryIt } from "@/lib/commands/try-it";
import { db } from "@/lib/db";
import { publish } from "@/server/events";
import { queues } from "@/server/queues";

// Thin adapters over src/lib/commands/try-it.ts (plan M5). Each new message
// is announced at once, so the inbox shows the ticket while it's triaged.

export async function submitTryItAction(input: {
  workspaceId: string;
  subject: string;
  text: string;
}) {
  const result = await submitTryIt({ db: db(), queues: queues() }, input);
  if (result.ok) await publish({ type: "ticket", ticketId: result.ticketId });
  return result;
}

export async function addTryItReplyAction(input: { ticketId: string; text: string }) {
  const result = await addTryItReply({ db: db(), queues: queues() }, input);
  if (result.ok) await publish({ type: "ticket", ticketId: input.ticketId });
  return result;
}

export async function simulateIncidentAction() {
  const result = await simulateIncident({ db: db(), queues: queues() });
  for (const ticketId of result.ticketIds) {
    // oxlint-disable-next-line eslint/no-await-in-loop
    await publish({ type: "ticket", ticketId });
  }
  return { ok: true as const, tickets: result.ticketIds.length };
}
