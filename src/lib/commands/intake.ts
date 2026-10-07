import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

import type { Db } from "@/lib/db";
import type { Queues } from "@/lib/queues";

import { Prisma } from "@/generated/prisma/client";
import { enqueueTriage } from "@/lib/queues";
import { MESSAGE_MAX_CHARS, SUBJECT_MAX_CHARS } from "@/lib/triage/state";

// Signed intake (plan M4): `/api/intake` takes a ticket, or a new message on a
// ticket it already has, from an outside system. The body is signed with
// HMAC-SHA256 under INTAKE_WEBHOOK_SECRET in `x-reflex-signature`
// (`sha256=<hex>`). Delivery is idempotent: the ticket's `externalId` and the
// message's `id` identify them, so a retried delivery adds nothing. Every new
// message queues a triage for the ticket's new message count.

export const SIGNATURE_HEADER = "x-reflex-signature";

/** Longer messages are accepted; the state keeps the first 2,500 characters of each. */
const MAX_INTAKE_CHARS = MESSAGE_MAX_CHARS * 8;

export const intakePayload = z
  .object({
    externalId: z.string().min(1).max(200),
    workspaceId: z.string().min(1),
    subject: z.string().trim().min(1).max(SUBJECT_MAX_CHARS),
    message: z
      .object({
        id: z.string().min(1).max(200),
        from: z.enum(["customer", "support"]).default("customer"),
        text: z.string().trim().min(1).max(MAX_INTAKE_CHARS),
      })
      .strict(),
  })
  .strict();

export type IntakePayload = z.input<typeof intakePayload>;

export type IntakeResult = {
  ticketId: string;
  created: boolean;
  messageAdded: boolean;
  messageCount: number;
};

export function signBody(body: string, secret: string): string {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

export function verifySignature(body: string, signature: string | null, secret: string): boolean {
  if (signature === null) return false;
  const expected = Buffer.from(signBody(body, secret));
  const given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

export class UnknownWorkspaceError extends Error {
  override name = "UnknownWorkspaceError";
}

export async function receiveIntake(
  { db: database, queues }: { db: Db; queues: Pick<Queues, "triage"> },
  input: IntakePayload,
  { source = "intake", now = new Date() }: { source?: "intake" | "try_it"; now?: Date } = {},
): Promise<IntakeResult> {
  const payload = intakePayload.parse(input);
  const result = await store(database, payload, source, now).catch(async (error: unknown) => {
    // Two first deliveries at once: one creates the ticket, the other adds to it.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return store(database, payload, source, now);
    }
    throw error;
  });
  if (result.messageAdded) {
    await enqueueTriage(queues, { ticketId: result.ticketId, messageCount: result.messageCount });
  }
  return result;
}

async function store(
  database: Db,
  { externalId, workspaceId, subject, message }: z.output<typeof intakePayload>,
  source: "intake" | "try_it",
  now: Date,
): Promise<IntakeResult> {
  return database.$transaction(async (tx) => {
    const ticket = await tx.ticket.findUnique({
      where: { externalId },
      include: { messages: { select: { externalId: true } } },
    });
    if (!ticket) {
      const workspace = await tx.workspace.findUnique({ where: { id: workspaceId } });
      if (!workspace) throw new UnknownWorkspaceError(`Unknown workspace ${workspaceId}`);
      const created = await tx.ticket.create({
        data: {
          externalId,
          source,
          workspaceId,
          subject,
          createdAt: now,
          messages: {
            create: {
              position: 0,
              externalId: message.id,
              from: message.from,
              text: message.text,
              createdAt: now,
            },
          },
        },
      });
      return { ticketId: created.id, created: true, messageAdded: true, messageCount: 1 };
    }
    const known = ticket.messages.some(({ externalId: id }) => id === message.id);
    if (!known) {
      await tx.message.create({
        data: {
          ticketId: ticket.id,
          position: ticket.messages.length,
          externalId: message.id,
          from: message.from,
          text: message.text,
          createdAt: now,
        },
      });
    }
    return {
      ticketId: ticket.id,
      created: false,
      messageAdded: !known,
      messageCount: ticket.messages.length + (known ? 0 : 1),
    };
  });
}

/** The whole route: signature, body, intake. Returns the status and JSON body to answer with. */
export async function handleIntake(
  deps: { db: Db; queues: Pick<Queues, "triage">; secret: string },
  { body, signature }: { body: string; signature: string | null },
): Promise<{ status: number; body: unknown }> {
  if (!verifySignature(body, signature, deps.secret)) {
    return { status: 401, body: { error: "invalid signature" } };
  }
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    return { status: 400, body: { error: "body is not JSON" } };
  }
  const parsed = intakePayload.safeParse(json);
  if (!parsed.success) {
    return { status: 400, body: { error: "invalid body", issues: parsed.error.issues } };
  }
  try {
    return { status: 202, body: await receiveIntake(deps, parsed.data) };
  } catch (error) {
    if (error instanceof UnknownWorkspaceError)
      return { status: 404, body: { error: error.message } };
    throw error;
  }
}
