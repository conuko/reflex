import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import type { TicketInput } from "@/lib/triage/state";

import { NON_GOALS } from "@/lib/config/non-goals";
import { buildQuestions } from "@/lib/triage/questions";
import { buildState } from "@/lib/triage/state";

// Jev has no published tokenizer, so these tests estimate one token per 3
// UTF-8 bytes. Measured with jev-1.13.0 on 2026-10-05, a ticket at every cap
// ran at ~4.5 bytes per token (state plus options 3,994 tokens), so the
// estimate errs high. The first test checks it against every recorded request.

const estimateTokens = (value: unknown) => Math.ceil(Buffer.byteLength(JSON.stringify(value)) / 3);

const fixturesDir = resolve(import.meta.dirname, "../fixtures/jev");
const recorded = z.object({
  request: z.object({ body: z.unknown() }),
  response: z.object({ body: z.object({ usage: z.object({ input_tokens: z.number() }) }) }),
});

const text =
  "Our agent run failed again with error 502 after the workflow called the CRM tool, and the logs show retries timing out. ";

const fill = (length: number) => text.repeat(Math.ceil(length / text.length)).slice(0, length);

// A ticket and candidates at every cap: more messages and longer texts than kept.
function largestTicket() {
  const ticket: TicketInput = {
    subject: fill(1_000),
    messages: Array.from({ length: 8 }, () => ({ from: "customer", text: fill(10_000) })),
  };
  const candidates = Array.from({ length: 10 }, (_, i) => ({
    issueId: `iss_${i}`,
    title: fill(1_000),
    excerpt: fill(5_000),
    state: "open" as const,
  }));
  const state = buildState(ticket);
  const { questions } = buildQuestions({ candidates, nonGoals: NON_GOALS });
  return { state, options: questions.duplicate_of?.criteria };
}

describe("Jev request size", () => {
  it.each(readdirSync(fixturesDir).filter((file) => file.endsWith(".json")))(
    "never estimates fewer tokens than Jev counted for %s",
    (file) => {
      const { request, response } = recorded.parse(
        JSON.parse(readFileSync(join(fixturesDir, file), "utf8")),
      );

      expect(estimateTokens(request.body)).toBeGreaterThanOrEqual(response.body.usage.input_tokens);
    },
  );

  it("keeps state plus options under 12k tokens for the largest allowed ticket", () => {
    const { state, options } = largestTicket();

    expect(estimateTokens(state) + estimateTokens(options)).toBeLessThan(12_000);
  });
});
