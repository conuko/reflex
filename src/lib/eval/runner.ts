import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";

import type {
  Judgment,
  JudgmentInput,
  JudgmentProvider,
  JudgmentProviderId,
} from "@/lib/judgment/provider";

import type { EvalItem } from "./sets";
import type { SplitPart } from "./split";

// Runs a judgment provider over eval items and appends one JSON line per
// finished item to a results file, so a run that was stopped resumes without
// asking for finished items again. The first line describes the run; a file
// made with a different provider, condition, question set or split is never
// resumed, so results from different runs can't mix.

export type RunHeader = {
  kind: "run";
  part: SplitPart;
  provider: JudgmentProviderId;
  /** How the items were asked, e.g. `candidates` or `shuffled` (see conditions.ts). */
  condition: string;
  questionSetVersion: string;
  questionSetHash: string;
  splitVersion: string;
  startedAt: string;
};

export type ItemRecord = { kind: "item"; id: string; ms: number; judgment: Judgment };

export type RunOutcome = {
  /** Items already in the file, not asked again. */
  skipped: number;
  finished: number;
  failed: { id: string; error: string }[];
};

/** The header fields a resumed file must share with the new run. */
const IDENTITY = [
  "part",
  "provider",
  "condition",
  "questionSetVersion",
  "questionSetHash",
  "splitVersion",
] as const;

export class RunMismatchError extends Error {
  override name = "RunMismatchError";
}

const headerSchema = z.object({
  kind: z.literal("run"),
  part: z.enum(["dev", "test"]),
  provider: z.enum(["jev", "fake"]),
  condition: z.string(),
  questionSetVersion: z.string(),
  questionSetHash: z.string(),
  splitVersion: z.string(),
  startedAt: z.string(),
});

const itemSchema = z.object({
  kind: z.literal("item"),
  id: z.string(),
  ms: z.number(),
  // Written by this module from a parsed judgment, so only its shape is checked.
  judgment: z.custom<Judgment>((value) => typeof value === "object" && value !== null),
});

export function readRun(file: string): { header: RunHeader; items: ItemRecord[] } | null {
  if (!existsSync(file)) return null;
  const [first, ...rest] = completeLines(readFileSync(file, "utf8"));
  if (first === undefined) return null;
  return {
    header: headerSchema.parse(JSON.parse(first)),
    items: rest.map((line) => itemSchema.parse(JSON.parse(line))),
  };
}

export async function runEval({
  file,
  header,
  items,
  provider,
  inputFor = (item) => ({ ticket: item.ticket, candidates: [] }),
  concurrency = 4,
  signal,
  onResult,
}: {
  file: string;
  header: RunHeader;
  items: readonly EvalItem[];
  provider: JudgmentProvider;
  /** What to send for an item; by default the ticket without candidates. */
  inputFor?: (item: EvalItem) => JudgmentInput;
  concurrency?: number;
  signal?: AbortSignal;
  onResult?: (result: { id: string; error?: string }) => void;
}): Promise<RunOutcome> {
  const existing = readRun(file);
  if (existing) {
    const different = IDENTITY.filter((key) => existing.header[key] !== header[key]);
    if (different.length > 0) {
      throw new RunMismatchError(
        `${file} was made with a different ${different.join(", ")}; choose another run name`,
      );
    }
    dropIncompleteLine(file);
  } else {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `${JSON.stringify(header)}\n`);
  }

  const done = new Set(existing?.items.map(({ id }) => id));
  const queue = items.filter(({ id }) => !done.has(id));
  const outcome: RunOutcome = { skipped: items.length - queue.length, finished: 0, failed: [] };

  const stopped = () => signal?.aborted === true;
  const work = async () => {
    for (let item = queue.shift(); item && !stopped(); item = queue.shift()) {
      const started = performance.now();
      try {
        // Each worker judges one item at a time; `concurrency` workers run side by side.
        // oxlint-disable-next-line eslint/no-await-in-loop
        const judgment = await provider.judge(inputFor(item), { signal });
        const ms = Math.round(performance.now() - started);
        const record: ItemRecord = { kind: "item", id: item.id, ms, judgment };
        // Synchronous, so lines from parallel workers never interleave.
        appendFileSync(file, `${JSON.stringify(record)}\n`);
        outcome.finished++;
        onResult?.({ id: item.id });
      } catch (error) {
        // A request cut off by stopping the run isn't a failure; the next run retries it.
        if (stopped()) break;
        const message = error instanceof Error ? error.message : String(error);
        outcome.failed.push({ id: item.id, error: message });
        onResult?.({ id: item.id, error: message });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, work));
  return outcome;
}

/** Appends a line to `test-runs.jsonl` in `dir` and returns how many test runs there have been. */
export function recordTestRun(dir: string, entry: { run: string; header: RunHeader }): number {
  const file = join(dir, "test-runs.jsonl");
  mkdirSync(dir, { recursive: true });
  appendFileSync(
    file,
    `${JSON.stringify({ run: entry.run, startedAt: entry.header.startedAt, questionSetHash: entry.header.questionSetHash })}\n`,
  );
  return completeLines(readFileSync(file, "utf8")).length;
}

// A process killed mid-write can leave a last line without its newline; it's
// ignored when reading and cut off before appending.
function completeLines(content: string): string[] {
  const end = content.lastIndexOf("\n");
  return end === -1
    ? []
    : content
        .slice(0, end)
        .split("\n")
        .filter((line) => line.length > 0);
}

function dropIncompleteLine(file: string) {
  const content = readFileSync(file, "utf8");
  if (!content.endsWith("\n")) writeFileSync(file, content.slice(0, content.lastIndexOf("\n") + 1));
}
