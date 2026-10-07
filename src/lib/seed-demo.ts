import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

import type { Db } from "@/lib/db";
import type { CandidateSnapshot } from "@/lib/eval/candidates-snapshot";
import type { EvalItem } from "@/lib/eval/sets";
import type { CorpusIssue } from "@/lib/issue-corpus";
import type { Judgment, JudgmentProvider } from "@/lib/judgment/provider";

import { NON_GOALS } from "@/lib/config/non-goals";
import { PLANS } from "@/lib/config/plans";
import { readCandidateSnapshot, snapshotCandidates } from "@/lib/eval/candidates-snapshot";
import { readRun } from "@/lib/eval/runner";
import { loadEvalItems } from "@/lib/eval/sets";
import { loadIssueCorpus, TRACKERS } from "@/lib/issue-corpus";
import { importIssueCorpus } from "@/lib/issues";
import { ensureFirstPolicy } from "@/lib/policies";
import { triage } from "@/lib/policy";
import { loadContexts, storedAnswers } from "@/lib/triage/context";
import { QUESTION_SET_VERSION, questionSetHash } from "@/lib/triage/questions";
import { setJevLink, storeJudgment, writeTriage } from "@/lib/triage/run-triage";

// The demo dataset (plan M4). Every eval item becomes a seed ticket: the 60
// support and 40 adversarial tickets, and the 80 corpus issues re-sent as
// tickets. Each goes to a synthetic workspace of its tracker and gets a
// creation time in the last 14 days, both chosen by a hash of its id, so
// every run places it the same way relative to the run date.
//
// Every run restores the seed state exactly: tickets that didn't come from
// the seed (intake, Try it), corrections, issues created in the app, incidents
// and policy versions above 1 are deleted, and the seed tickets' links and
// triages are rebuilt from stored judgments. A seed ticket's judgment is the
// one stored by an earlier run, else the committed eval result for the frozen
// question set, else the configured provider is asked once. The committed
// results cover every item, so a fresh clone seeds with 0 model calls.

const WORKSPACES_FILE = join(import.meta.dirname, "../../data/synthetic/workspaces.json");
const RESULTS_DIR = join(import.meta.dirname, "../../eval/results");
const DAYS = 14;
const MINUTES_BETWEEN_MESSAGES = 20;

const workspacesFile = z
  .object({
    note: z.string(),
    workspaces: z.array(
      z
        .object({
          id: z.string(),
          name: z.string(),
          tracker: z.enum(TRACKERS),
          plan: z.enum(PLANS),
          seats: z.int().positive(),
          arr: z.int().min(0),
        })
        .strict(),
    ),
  })
  .strict();

export type SyntheticWorkspace = z.infer<typeof workspacesFile>["workspaces"][number];

export function loadWorkspaces(path: string = WORKSPACES_FILE): SyntheticWorkspace[] {
  return workspacesFile.parse(JSON.parse(readFileSync(path, "utf8"))).workspaces;
}

export type SeedOptions = {
  db: Db;
  /** Asked only for items with neither a stored nor a committed judgment. */
  provider: JudgmentProvider;
  now?: Date;
  items?: readonly EvalItem[];
  workspaces?: readonly SyntheticWorkspace[];
  snapshot?: CandidateSnapshot;
  issues?: readonly CorpusIssue[];
  resultsDir?: string;
};

export type SeedOutcome = {
  workspaces: number;
  tickets: number;
  judgments: { reused: number; fromResults: number; asked: number };
  links: number;
};

export async function seedDemo({
  db: database,
  provider,
  now = new Date(),
  items = loadEvalItems(),
  workspaces = loadWorkspaces(),
  snapshot = readCandidateSnapshot(),
  issues = loadIssueCorpus(),
  resultsDir = RESULTS_DIR,
}: SeedOptions): Promise<SeedOutcome> {
  await importIssueCorpus(database, issues);
  for (const workspace of workspaces) {
    // oxlint-disable-next-line eslint/no-await-in-loop
    await database.workspace.upsert({
      where: { id: workspace.id },
      create: workspace,
      update: workspace,
    });
  }

  // Back to the seed state: everything a demo run added goes.
  await database.ticket.deleteMany({ where: { source: { not: "seed" } } });
  await database.correction.deleteMany();
  await database.incident.deleteMany();
  await database.policy.deleteMany({ where: { version: { gt: 1 } } });
  await database.issue.deleteMany({ where: { source: { not: "corpus" } } });
  const policy = await ensureFirstPolicy(database);

  const committed = committedJudgments(resultsDir);
  const issueMap = new Map(issues.map((issue) => [issue.id, issue]));
  const outcome: SeedOutcome = {
    workspaces: workspaces.length,
    tickets: items.length,
    judgments: { reused: 0, fromResults: 0, asked: 0 },
    links: 0,
  };
  const seeded: { ticketId: string; judgmentId: string; judgment: Judgment }[] = [];

  for (const item of items) {
    // oxlint-disable-next-line eslint/no-await-in-loop
    const ticketId = await upsertTicket(database, item, workspaceFor(item, workspaces), now);
    const messageCount = item.ticket.messages.length;
    // oxlint-disable-next-line eslint/no-await-in-loop
    const stored = await database.judgment.findFirst({
      where: { ticketId, questionSetVersion: QUESTION_SET_VERSION, messageCount },
      orderBy: { createdAt: "desc" },
    });
    if (stored) {
      outcome.judgments.reused++;
      seeded.push({ ticketId, judgmentId: stored.id, judgment: fromStored(stored) });
      continue;
    }
    let judgment = committed.get(item.id);
    let origin: "eval" | "live" = "eval";
    if (judgment) {
      outcome.judgments.fromResults++;
    } else {
      // oxlint-disable-next-line eslint/no-await-in-loop
      judgment = await provider.judge({
        ticket: item.ticket,
        candidates: snapshotCandidates(snapshot, item, issueMap),
      });
      outcome.judgments.asked++;
      origin = "live";
    }
    // oxlint-disable-next-line eslint/no-await-in-loop
    const judgmentId = await storeJudgment(database, ticketId, judgment, origin);
    seeded.push({ ticketId, judgmentId, judgment });
  }

  // Links first, since a feature request's priority depends on its issue's demand.
  await database.ticketIssueLink.deleteMany({ where: { ticket: { source: "seed" } } });
  for (const { ticketId, judgment } of seeded) {
    const pick = judgment.answers.duplicate;
    const linkTo =
      pick?.issueId && pick.probability >= policy.values.minDuplicateProbability
        ? pick.issueId
        : null;
    // oxlint-disable-next-line eslint/no-await-in-loop
    outcome.links += (await setJevLink(database, ticketId, linkTo)).length;
  }

  await database.triage.deleteMany({ where: { ticket: { source: "seed" } } });
  await database.ticket.updateMany({ where: { source: "seed" }, data: { humanPriority: null } });
  const tickets = await database.ticket.findMany({
    where: { id: { in: seeded.map(({ ticketId }) => ticketId) } },
    include: { workspace: true, links: true },
  });
  const byId = new Map(seeded.map((entry) => [entry.ticketId, entry]));
  const contexts = await loadContexts(
    database,
    tickets.flatMap((ticket) => {
      const entry = byId.get(ticket.id);
      return entry
        ? [
            {
              id: ticket.id,
              createdAt: ticket.createdAt,
              plan: ticket.workspace.plan,
              tracker: ticket.workspace.tracker,
              answers: entry.judgment.answers,
              linkedIssueIds: ticket.links.map(({ issueId }) => issueId),
            },
          ]
        : [];
    }),
  );
  for (const ticket of tickets) {
    const entry = byId.get(ticket.id);
    const context = contexts.get(ticket.id);
    if (!entry || !context) continue;
    // oxlint-disable-next-line eslint/no-await-in-loop
    await writeTriage(database, {
      ticketId: ticket.id,
      judgmentId: entry.judgmentId,
      messageCount: entry.judgment.messageCount,
      policyVersion: policy.version,
      result: triage(entry.judgment.answers, context, policy.values),
    });
  }
  return outcome;
}

/** The seed ticket's external id for an eval item. */
export function seedExternalId(itemId: string): string {
  return `seed-${itemId}`;
}

async function upsertTicket(
  database: Db,
  item: EvalItem,
  workspace: SyntheticWorkspace,
  now: Date,
): Promise<string> {
  const createdAt = seedTime(item.id, now);
  const fields = {
    source: "seed",
    workspaceId: workspace.id,
    subject: item.ticket.subject,
    createdAt,
    sourceIssueId: item.set === "corpus" ? item.id : null,
    humanPriority: null,
  };
  const { id } = await database.ticket.upsert({
    where: { externalId: seedExternalId(item.id) },
    create: { externalId: seedExternalId(item.id), ...fields },
    update: fields,
    select: { id: true },
  });
  await database.message.deleteMany({ where: { ticketId: id } });
  await database.message.createMany({
    data: item.ticket.messages.map(({ from, text }, position) => ({
      ticketId: id,
      position,
      externalId: `seed-${position}`,
      from,
      text,
      createdAt: new Date(
        Math.min(now.getTime(), createdAt.getTime() + position * MINUTES_BETWEEN_MESSAGES * 60_000),
      ),
    })),
  });
  return id;
}

/** A workspace of the item's tracker, picked by a hash of the item's id. */
export function workspaceFor(
  item: EvalItem,
  workspaces: readonly SyntheticWorkspace[],
): SyntheticWorkspace {
  const options = workspaces.filter(({ tracker }) => tracker === item.tracker);
  const chosen = options[fraction(`workspace:${item.id}`, options.length)];
  if (!chosen) throw new Error(`No workspace for tracker ${item.tracker}`);
  return chosen;
}

/** A time in the 14 days before `now`, picked by a hash of the item's id, on a whole minute. */
export function seedTime(itemId: string, now: Date): Date {
  const minutes = fraction(`time:${itemId}`, DAYS * 24 * 60);
  return new Date(Math.floor(now.getTime() / 60_000) * 60_000 - minutes * 60_000);
}

function fraction(key: string, size: number): number {
  return createHash("sha256").update(key).digest().readUInt32BE(0) % size;
}

/** The candidates-run judgments for the current question set, by item id. */
function committedJudgments(dir: string): Map<string, Judgment> {
  const hash = questionSetHash(NON_GOALS);
  const judgments = new Map<string, Judgment>();
  const files = readdirSync(dir).filter((file) =>
    new RegExp(`^(dev|test)-jev-${QUESTION_SET_VERSION}-candidates\\.jsonl$`).test(file),
  );
  for (const file of files.toSorted()) {
    const run = readRun(join(dir, file));
    if (!run || run.header.questionSetHash !== hash) continue;
    for (const { id, judgment } of run.items) if (!judgments.has(id)) judgments.set(id, judgment);
  }
  return judgments;
}

function fromStored(row: {
  provider: string;
  model: string;
  requestId: string | null;
  questionSetVersion: string;
  messageCount: number;
  state: unknown;
  candidateMap: unknown;
  answers: unknown;
  inputTokens: number;
  outputTokens: number;
}): Judgment {
  return {
    provider: row.provider === "fake" ? "fake" : "jev",
    model: row.model,
    requestId: row.requestId,
    questionSetVersion: row.questionSetVersion,
    messageCount: row.messageCount,
    state: storedState.parse(row.state),
    candidateMap: z.record(z.string(), z.string()).parse(row.candidateMap),
    answers: storedAnswers.parse(row.answers),
    usage: { inputTokens: row.inputTokens, outputTokens: row.outputTokens },
  };
}

const storedState = z.object({
  ticket: z.object({
    subject: z.string(),
    messages: z.array(z.object({ from: z.enum(["customer", "support"]), text: z.string() })),
  }),
});
