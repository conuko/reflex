import { parseArgs } from "node:util";

import type { JudgmentProviderId } from "@/lib/judgment/provider";

import type { SplitPart } from "./split";

import { SPLIT_PARTS } from "./split";

// Arguments of `pnpm eval:run`, parsed apart from the script so the rules are
// testable. Test is only run on purpose: `--part test` needs `--confirm-test`.

/** The questions `--only` can report on in M1. */
export const REPORTED_QUESTIONS = ["type", "area"] as const;
export type ReportedQuestion = (typeof REPORTED_QUESTIONS)[number];

const PROVIDERS = ["jev", "fake"] as const satisfies readonly JudgmentProviderId[];
const MAX_CONCURRENCY = 16;

export type EvalArgs = {
  part: SplitPart;
  provider: JudgmentProviderId;
  only: ReportedQuestion[];
  /** Results file name without `.jsonl`; `null` picks one from the run. */
  run: string | null;
  concurrency: number;
};

export class EvalArgsError extends Error {
  override name = "EvalArgsError";
}

export const EVAL_USAGE =
  "Usage: pnpm eval:run --part dev|test [--provider jev|fake] [--only type,area] [--run <name>] [--concurrency <n>] [--confirm-test]";

export function parseEvalArgs(argv: readonly string[]): EvalArgs {
  let values;
  try {
    ({ values } = parseArgs({
      args: [...argv],
      options: {
        part: { type: "string" },
        provider: { type: "string", default: "jev" },
        only: { type: "string", default: REPORTED_QUESTIONS.join(",") },
        run: { type: "string" },
        concurrency: { type: "string", default: "4" },
        "confirm-test": { type: "boolean", default: false },
      },
      strict: true,
    }));
  } catch (error) {
    throw new EvalArgsError(error instanceof Error ? error.message : String(error));
  }

  const part = oneOf(values.part, SPLIT_PARTS, "--part");
  if (part === "test" && !values["confirm-test"]) {
    throw new EvalArgsError(
      "Refusing to run on test without --confirm-test. Test is run once per frozen question set (plan M3); tune on dev.",
    );
  }

  const only = values.only
    .split(",")
    .map((question) => oneOf(question, REPORTED_QUESTIONS, "--only"));
  const concurrency = Number(values.concurrency);
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > MAX_CONCURRENCY) {
    throw new EvalArgsError(`--concurrency must be a whole number from 1 to ${MAX_CONCURRENCY}`);
  }
  if (values.run !== undefined && !/^[\w.-]+$/.test(values.run)) {
    throw new EvalArgsError("--run may only contain letters, digits, '.', '-' and '_'");
  }

  return {
    part,
    provider: oneOf(values.provider, PROVIDERS, "--provider"),
    only: [...new Set(only)],
    run: values.run ?? null,
    concurrency,
  };
}

function oneOf<const T extends string>(
  value: string | undefined,
  allowed: readonly T[],
  flag: string,
): T {
  const match = allowed.find((option) => option === value);
  if (match === undefined) {
    throw new EvalArgsError(
      `${flag} must be one of ${allowed.join(", ")}${value === undefined ? "" : `, got "${value}"`}`,
    );
  }
  return match;
}
