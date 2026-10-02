import { z } from "zod";

// Lazy env parsers: nothing is read at import time, so `next build` and
// `prisma generate` need no runtime env. A missing or invalid variable fails on
// first call with its exact name.

type EnvSource = Record<string, string | undefined>;

export class EnvError extends Error {
  override name = "EnvError";
}

const shared = {
  DATABASE_URL: z.string(),
  REDIS_URL: z.string(),
};

const webSchema = z.object({
  ...shared,
  INTAKE_WEBHOOK_SECRET: z.string().min(32, "must be at least 32 characters"),
});

const workerSchema = z.discriminatedUnion(
  "JUDGMENT_PROVIDER",
  [
    z.object({
      ...shared,
      JUDGMENT_PROVIDER: z.literal("jev"),
      TYPESAFE_API_KEY: z.string(),
    }),
    z.object({ ...shared, JUDGMENT_PROVIDER: z.literal("fake") }),
  ],
  { error: 'must be one of "jev", "fake"' },
);

export type WebEnv = z.infer<typeof webSchema>;
export type WorkerEnv = z.infer<typeof workerSchema>;
export type JudgmentProviderId = WorkerEnv["JUDGMENT_PROVIDER"];

export function parseWebEnv(source: EnvSource): WebEnv {
  return parse(webSchema, withoutBlanks(source));
}

export function parseWorkerEnv(source: EnvSource): WorkerEnv {
  return parse(workerSchema, { JUDGMENT_PROVIDER: "jev", ...withoutBlanks(source) });
}

let web: WebEnv | undefined;
let worker: WorkerEnv | undefined;

export function webEnv(): WebEnv {
  return (web ??= parseWebEnv(process.env));
}

export function workerEnv(): WorkerEnv {
  return (worker ??= parseWorkerEnv(process.env));
}

function parse<T>(schema: z.ZodType<T>, source: EnvSource): T {
  const result = schema.safeParse(source);
  if (result.success) return result.data;
  throw new EnvError(
    [
      "Invalid environment:",
      ...result.error.issues.map((issue) => `  - ${formatIssue(issue)}`),
    ].join("\n"),
  );
}

// An empty value (as in `.env.example`) counts as missing.
function withoutBlanks(source: EnvSource): EnvSource {
  return Object.fromEntries(Object.entries(source).filter(([, value]) => value));
}

function formatIssue(issue: z.core.$ZodIssue): string {
  const name = String(issue.path[0]);
  // Every present value is a string, so a type error means the variable is missing.
  if (issue.code === "invalid_type") return `Missing environment variable ${name}`;
  return `${name} ${issue.message}`;
}
