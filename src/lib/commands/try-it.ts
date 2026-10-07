import { randomUUID } from "node:crypto";
import { z } from "zod";

import type { Db } from "@/lib/db";
import type { Queues } from "@/lib/queues";

import { TRY_IT_MAX_CHARS } from "@/lib/config/try-it";
import { burstExternalId, loadIncidentBurst } from "@/lib/demo";
import { SUBJECT_MAX_CHARS } from "@/lib/triage/state";

import type { Invalid } from "./result";

import { receiveIntake, UnknownWorkspaceError } from "./intake";
import { fieldErrors, invalid } from "./result";

// Try it (plan M5): a visitor pastes a ticket, picks a workspace and watches
// the triage arrive; a reply re-triages it. The ticket goes through the same
// intake as any other, marked `try_it`, so the next `pnpm seed:demo` removes
// it. Its only limit is 8,000 characters per ticket, subject and every message
// together.

type Deps = { db: Db; queues: Pick<Queues, "triage"> };

const limitMessage = (used: number) =>
  `A Try-it ticket is at most ${TRY_IT_MAX_CHARS.toLocaleString("en-US")} characters; this one would have ${used.toLocaleString("en-US")}`;

export const tryItInput = z
  .object({
    workspaceId: z.string().min(1, "Pick a workspace"),
    subject: z.string().trim().min(1, "Write a subject").max(SUBJECT_MAX_CHARS),
    text: z.string().trim().min(1, "Write the customer's message"),
  })
  .strict()
  .superRefine(({ subject, text }, ctx) => {
    const used = subject.length + text.length;
    if (used > TRY_IT_MAX_CHARS)
      ctx.addIssue({ code: "custom", path: ["text"], message: limitMessage(used) });
  });

export async function submitTryIt(
  deps: Deps,
  input: z.input<typeof tryItInput>,
  { now = new Date() }: { now?: Date } = {},
): Promise<Invalid | { ok: true; ticketId: string }> {
  const parsed = tryItInput.safeParse(input);
  if (!parsed.success) return { ok: false, errors: fieldErrors(parsed.error) };
  const { workspaceId, subject, text } = parsed.data;
  try {
    const { ticketId } = await receiveIntake(
      deps,
      { externalId: `try-${randomUUID()}`, workspaceId, subject, message: { id: "m1", text } },
      { source: "try_it", now },
    );
    return { ok: true, ticketId };
  } catch (error) {
    if (error instanceof UnknownWorkspaceError) return invalid("workspaceId", "No such workspace");
    throw error;
  }
}

export const tryItReplyInput = z
  .object({ ticketId: z.string().min(1), text: z.string().trim().min(1, "Write the reply") })
  .strict();

/** A customer reply on a Try-it ticket; it queues a re-triage of the whole thread. */
export async function addTryItReply(
  deps: Deps,
  input: z.input<typeof tryItReplyInput>,
  { now = new Date() }: { now?: Date } = {},
): Promise<Invalid | { ok: true; messageCount: number }> {
  const parsed = tryItReplyInput.safeParse(input);
  if (!parsed.success) return { ok: false, errors: fieldErrors(parsed.error) };
  const { ticketId, text } = parsed.data;
  const ticket = await deps.db.ticket.findUnique({
    where: { id: ticketId },
    include: { messages: { select: { text: true } } },
  });
  if (ticket?.source !== "try_it")
    return invalid("ticketId", "Only Try-it tickets take replies here");

  const used =
    ticket.subject.length + ticket.messages.reduce((sum, message) => sum + message.text.length, 0);
  if (used + text.length > TRY_IT_MAX_CHARS)
    return invalid("text", limitMessage(used + text.length));

  const { messageCount } = await receiveIntake(
    deps,
    {
      externalId: ticket.externalId,
      workspaceId: ticket.workspaceId,
      subject: ticket.subject,
      message: { id: `m${ticket.messages.length + 1}`, text },
    },
    { source: "try_it", now },
  );
  return { ok: true, messageCount };
}

/** Sends the hand-written incident burst through intake directly, as one new burst. */
export async function simulateIncident(
  deps: Deps,
  { now = new Date(), run = now.getTime().toString(36) }: { now?: Date; run?: string } = {},
): Promise<{ ok: true; ticketIds: string[] }> {
  const ticketIds: string[] = [];
  for (const [index, { workspaceId, subject, text }] of loadIncidentBurst().entries()) {
    // One after another, like separate customers writing in.
    // oxlint-disable-next-line eslint/no-await-in-loop
    const { ticketId } = await receiveIntake(
      deps,
      {
        externalId: burstExternalId(run, index),
        workspaceId,
        subject,
        message: { id: "m1", text },
      },
      { now },
    );
    ticketIds.push(ticketId);
  }
  return { ok: true, ticketIds };
}
