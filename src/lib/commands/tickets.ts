import { z } from "zod";

import type { Db } from "@/lib/db";
import type { Queues } from "@/lib/queues";

import { Prisma } from "@/generated/prisma/client";
import { ISSUE_TITLE_MAX_CHARS } from "@/lib/config/issues";
import { TRIAGE_PRIORITIES } from "@/lib/priorities";
import { enqueueRecompute } from "@/lib/queues";
import { recomputeTriages } from "@/lib/recompute";

import type { Invalid } from "./result";

import { fieldErrors, NotFoundError } from "./result";

// What a person does with a ticket in the inbox (plan M5). The server actions
// in src/app/actions/ are thin adapters over these, so the logic is tested
// without Next. A person's choice is kept apart from the policy's: a set
// priority is an override that recompute skips, and every change from what
// Jev or the policy said is kept as a Correction.

type Deps = { db: Db; queues: Pick<Queues, "recompute"> };

const ticketId = z.string().min(1);

export const setPriorityInput = z
  .object({ ticketId, priority: z.enum(TRIAGE_PRIORITIES) })
  .strict();

/**
 * Sets a person's priority: an override recompute never changes. A change
 * from the priority in force is kept as a Correction.
 */
export async function setPriority(
  { db: database }: Pick<Deps, "db">,
  input: z.input<typeof setPriorityInput>,
  now: Date = new Date(),
): Promise<{ ok: true; changed: boolean }> {
  const { ticketId: id, priority } = setPriorityInput.parse(input);
  const ticket = await database.ticket.findUnique({ where: { id }, include: { triage: true } });
  if (!ticket) throw new NotFoundError(`Unknown ticket ${id}`);
  const current = ticket.humanPriority ?? ticket.triage?.priority ?? null;

  await database.$transaction([
    ...(current === priority
      ? []
      : [
          database.correction.create({
            data: { ticketId: id, field: "priority", fromValue: current, toValue: priority },
          }),
        ]),
    database.ticket.update({ where: { id }, data: { humanPriority: priority, acceptedAt: now } }),
  ]);
  return { ok: true, changed: current !== priority };
}

/** Confirms the suggested triage; the ticket keeps following the policy. */
export async function acceptTriage(
  { db: database }: Pick<Deps, "db">,
  input: { ticketId: string },
  now: Date = new Date(),
): Promise<{ ok: true }> {
  const id = ticketId.parse(input.ticketId);
  const ticket = await database.ticket.findUnique({ where: { id }, select: { id: true } });
  if (!ticket) throw new NotFoundError(`Unknown ticket ${id}`);
  await database.ticket.update({ where: { id }, data: { acceptedAt: now } });
  return { ok: true };
}

export const linkIssueInput = z.object({ ticketId, issueId: z.string().min(1) }).strict();

/**
 * Links the ticket to an existing issue of its workspace's tracker, as a
 * person's link (Jev's link to the same issue becomes the person's). The
 * issue's demand changes, so its linked tickets are recomputed.
 */
export async function linkIssue(
  { db: database, queues }: Deps,
  input: z.input<typeof linkIssueInput>,
): Promise<Invalid | { ok: true }> {
  const parsed = linkIssueInput.safeParse(input);
  if (!parsed.success) return { ok: false, errors: fieldErrors(parsed.error) };
  const { ticketId: id, issueId } = parsed.data;
  const ticket = await loadTicket(database, id);
  const issue = await database.issue.findUnique({ where: { id: issueId } });
  if (!issue) return { ok: false, errors: { issueId: [`No issue ${issueId}`] } };
  if (issue.tracker !== ticket.workspace.tracker) {
    return {
      ok: false,
      errors: { issueId: [`${issueId} isn't in the ${ticket.workspace.tracker} tracker`] },
    };
  }

  const existing = ticket.links.find((link) => link.issueId === issueId);
  if (existing?.origin === "human") return { ok: true };
  await database.$transaction([
    database.ticketIssueLink.upsert({
      where: { ticketId_issueId: { ticketId: id, issueId } },
      create: { ticketId: id, issueId, origin: "human" },
      update: { origin: "human" },
    }),
    ...(existing
      ? []
      : [
          database.correction.create({
            data: {
              ticketId: id,
              field: "duplicate",
              fromValue: jevLink(ticket),
              toValue: issueId,
            },
          }),
        ]),
  ]);
  await enqueueRecompute(queues, { reason: "demand", issueId });
  return { ok: true };
}

/** Removes a link, Jev's or a person's, and recomputes the ticket and the issue's other tickets. */
export async function unlinkIssue(
  { db: database, queues }: Deps,
  input: z.input<typeof linkIssueInput>,
): Promise<{ ok: true }> {
  const { ticketId: id, issueId } = linkIssueInput.parse(input);
  const ticket = await loadTicket(database, id);
  if (!ticket.links.some((link) => link.issueId === issueId)) return { ok: true };

  await database.$transaction([
    database.ticketIssueLink.delete({ where: { ticketId_issueId: { ticketId: id, issueId } } }),
    database.correction.create({
      data: { ticketId: id, field: "duplicate", fromValue: issueId, toValue: "none" },
    }),
  ]);
  // The ticket no longer carries the issue's demand; the issue's other tickets lose its share.
  await recomputeTriages(database, { ticketIds: [id] });
  await enqueueRecompute(queues, { reason: "demand", issueId });
  return { ok: true };
}

export const createIssueInput = z
  .object({ ticketId, title: z.string().trim().min(1).max(ISSUE_TITLE_MAX_CHARS) })
  .strict();

/**
 * Creates an issue in the ticket's tracker and links the ticket to it. The
 * title comes from the person (prefilled with the subject) and the body is
 * the first customer message, copied: Jev doesn't write text (ADR-0003).
 */
export async function createIssue(
  { db: database, queues }: Deps,
  input: z.input<typeof createIssueInput>,
  now: Date = new Date(),
): Promise<Invalid | { ok: true; issueId: string }> {
  const parsed = createIssueInput.safeParse(input);
  if (!parsed.success) return { ok: false, errors: fieldErrors(parsed.error) };
  const { ticketId: id, title } = parsed.data;
  const ticket = await loadTicket(database, id);
  const first = ticket.messages.find(({ from }) => from === "customer") ?? ticket.messages[0];
  const { tracker } = ticket.workspace;

  const create = () =>
    database.$transaction(async (tx) => {
      const last = await tx.issue.findFirst({ where: { tracker }, orderBy: { number: "desc" } });
      const number = (last?.number ?? 0) + 1;
      const issueId = `${tracker}#${number}`;
      await tx.issue.create({
        data: {
          id: issueId,
          tracker,
          number,
          source: "app",
          title,
          body: first?.text ?? "",
          createdAt: now,
        },
      });
      await tx.ticketIssueLink.create({ data: { ticketId: id, issueId, origin: "human" } });
      await tx.correction.create({
        data: { ticketId: id, field: "duplicate", fromValue: jevLink(ticket), toValue: issueId },
      });
      return issueId;
    });
  // Two issues created at once in one tracker: the second takes the next number.
  const issueId = await create().catch((error: unknown) => {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return create();
    }
    throw error;
  });
  await enqueueRecompute(queues, { reason: "demand", issueId });
  return { ok: true, issueId };
}

async function loadTicket(database: Db, id: string) {
  const ticket = await database.ticket.findUnique({
    where: { id },
    include: { workspace: true, links: true, messages: { orderBy: { position: "asc" } } },
  });
  if (!ticket) throw new NotFoundError(`Unknown ticket ${id}`);
  return ticket;
}

function jevLink(ticket: { links: { issueId: string; origin: string }[] }): string | null {
  return ticket.links.find(({ origin }) => origin === "jev")?.issueId ?? null;
}
