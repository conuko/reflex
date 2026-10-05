// `pnpm jev:smoke [--record]`: one Jev request per hand-written ticket, printing
// every answer, the request id, the served model and the input tokens. Fails
// if a request uses 8k input tokens or more. `--record` also saves each
// request and response to test/fixtures/jev/ for the contract test.

import type { Fetch } from "@typesafe-ai/sdk";

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { Judgment } from "@/lib/judgment/provider";

import { scriptEnv } from "@/lib/env";
import { createJevClient, createJevProvider } from "@/lib/judgment/jev-provider";
import { nonGoalQuestionId } from "@/lib/triage/questions";

import { SMOKE_TICKETS } from "./jev-smoke-tickets";

const INPUT_TOKEN_BUDGET = 8_000;
const FIXTURES_DIR = join(import.meta.dirname, "../test/fixtures/jev");

const { TYPESAFE_API_KEY } = scriptEnv("TYPESAFE_API_KEY");
const record = process.argv.includes("--record");

for (const [index, { name, input }] of SMOKE_TICKETS.entries()) {
  const recorder = record ? recordingFetch() : undefined;
  const provider = createJevProvider({
    client: createJevClient({ apiKey: TYPESAFE_API_KEY, fetch: recorder?.fetch }),
  });

  const started = performance.now();
  // One ticket at a time, so the printed answers and timings stay readable.
  // oxlint-disable-next-line eslint/no-await-in-loop
  const judgment = await provider.judge(input);
  const seconds = (performance.now() - started) / 1000;

  console.log(`\n[${index + 1}/${SMOKE_TICKETS.length}] ${name}: "${input.ticket.subject}"`);
  console.log(
    `  request ${judgment.requestId ?? "(none)"}, model ${judgment.model}, ` +
      `${judgment.usage.inputTokens} input tokens, ${seconds.toFixed(1)} s`,
  );
  for (const [question, answer] of formatAnswers(judgment)) {
    console.log(`  ${question.padEnd(28)} ${answer}`);
  }

  if (judgment.usage.inputTokens >= INPUT_TOKEN_BUDGET) {
    console.error(`  over budget: ${judgment.usage.inputTokens} ≥ ${INPUT_TOKEN_BUDGET} tokens`);
    process.exitCode = 1;
  }
  if (recorder) {
    mkdirSync(FIXTURES_DIR, { recursive: true });
    const file = join(FIXTURES_DIR, `${name}.json`);
    writeFileSync(file, `${JSON.stringify({ input, ...recorder.exchange() }, null, 2)}\n`);
    console.log(`  recorded ${file}`);
  }
}

function formatAnswers({ answers }: Judgment): [string, string][] {
  return [
    ["type", choice(answers.type)],
    ["area", choice(answers.area)],
    ["reach", choice(answers.reach)],
    ["blocked", yesNo(answers.blocked)],
    ["workaround", yesNo(answers.workaround)],
    ["data_exposure", yesNo(answers.dataExposure)],
    ["data_loss", yesNo(answers.dataLoss)],
    ["regression", yesNo(answers.regression)],
    ["frustration", `${answers.frustration.score.toFixed(2)} of 4`],
    [
      "duplicate_of",
      answers.duplicate
        ? `${choice(answers.duplicate)}${answers.duplicate.issueId ? ` → ${answers.duplicate.issueId}` : ""}`
        : "(no candidates)",
    ],
    ...Object.entries(answers.nonGoals).map(([id, p]): [string, string] => [
      nonGoalQuestionId(id),
      yesNo(p),
    ]),
    ["injection", yesNo(answers.injection)],
  ];
}

function choice(answer: { choice: string; probability: number }): string {
  return `${answer.choice} (${answer.probability.toFixed(2)})`;
}

function yesNo(probability: number): string {
  return `${probability >= 0.5 ? "yes" : "no"} (p=${probability.toFixed(2)})`;
}

// Records the last request and response a client makes. Only the response
// headers the SDK reads are kept; request headers (with the key) never are.
function recordingFetch() {
  let request: unknown;
  let response: unknown;

  const fetch: Fetch = async (url, init) => {
    const res = await globalThis.fetch(url, init);
    request = {
      path: new URL(url).pathname,
      body: JSON.parse(typeof init?.body === "string" ? init.body : "null") as unknown,
    };
    response = {
      status: res.status,
      headers: Object.fromEntries(
        ["content-type", "x-typesafe-request-id"].flatMap((name) => {
          const value = res.headers.get(name);
          return value === null ? [] : [[name, value]];
        }),
      ),
      body: (await res.clone().json()) as unknown,
    };
    return res;
  };

  return { fetch, exchange: () => ({ request, response }) };
}
