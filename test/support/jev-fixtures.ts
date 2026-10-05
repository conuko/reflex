import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { z } from "zod";

// Jev requests and responses recorded by `pnpm jev:smoke --record`.

const fixturesDir = resolve(import.meta.dirname, "../fixtures/jev");

const jevFixture = z.object({
  input: z.object({
    ticket: z.object({
      subject: z.string(),
      messages: z.array(z.object({ from: z.enum(["customer", "support"]), text: z.string() })),
    }),
    candidates: z.array(
      z.object({
        issueId: z.string(),
        title: z.string(),
        excerpt: z.string(),
        state: z.enum(["open", "closed"]),
      }),
    ),
  }),
  request: z.object({ path: z.string(), body: z.record(z.string(), z.unknown()) }),
  response: z.object({
    status: z.number(),
    headers: z.record(z.string(), z.string()),
    body: z.unknown(),
  }),
});

export type JevFixture = z.infer<typeof jevFixture> & { name: string };

export function loadJevFixtures(): JevFixture[] {
  return readdirSync(fixturesDir)
    .filter((file) => file.endsWith(".json"))
    .map((file) =>
      Object.assign(jevFixture.parse(JSON.parse(readFileSync(join(fixturesDir, file), "utf8"))), {
        name: file.replace(/\.json$/, ""),
      }),
    );
}
