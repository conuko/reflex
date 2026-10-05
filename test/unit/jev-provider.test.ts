import type { Fetch } from "@typesafe-ai/sdk";

import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  createJevClient,
  createJevProvider,
  isRetryableJevError,
  JEV_MODEL,
} from "@/lib/judgment/jev-provider";
import { QUESTION_SET_VERSION } from "@/lib/triage/questions";

import type { JevFixture } from "../support/jev-fixtures";

import { loadJevFixtures } from "../support/jev-fixtures";

// Contract test: the real SDK client, with a fetch that replays responses
// recorded from the Jev API by `pnpm jev:smoke --record`. A replay only
// answers the exact request it was recorded for, so a fixture that no longer
// matches the question set fails here until it's re-recorded.

const fixtures = loadJevFixtures();

const fixture = (name: string): JevFixture => {
  const found = fixtures.find((f) => f.name === name);
  if (!found) throw new Error(`No Jev fixture named ${name}`);
  return found;
};

const requestBody = z.object({
  model: z.string(),
  state: z.unknown(),
  questions: z.record(z.string(), z.unknown()),
});

describe("Jev judgment provider (recorded responses)", () => {
  it.each(fixtures)("sends the recorded request for $name and parses the answers", async (f) => {
    const provider = createJevProvider({ client: client(replay(f)) });

    const judgment = await provider.judge(f.input);

    expect(judgment).toMatchObject({
      provider: "jev",
      model: "jev-1.13.0",
      requestId: f.response.headers["x-typesafe-request-id"],
      questionSetVersion: QUESTION_SET_VERSION,
      messageCount: f.input.ticket.messages.length,
    });
    expect(Object.keys(judgment.answers.nonGoals)).toHaveLength(3);
    expect(judgment.usage.inputTokens).toBeGreaterThan(0);
  });

  it("maps a duplicate answer to the candidate's issue id", async () => {
    const f = fixture("sso-login-loop");

    const judgment = await createJevProvider({ client: client(replay(f)) }).judge(f.input);

    expect(judgment).toMatchObject({
      requestId: "req_01a10b4a97e07876af76a4b7824b7489",
      usage: { inputTokens: 4539 },
      answers: {
        type: { choice: "bug" },
        area: { choice: "admin_sso" },
        reach: { choice: "whole_workspace" },
        duplicate: { choice: "c2", issueId: "iss_102" },
      },
    });
    expect(judgment.answers.regression).toBeGreaterThan(0.9);
    expect(judgment.candidateMap.c2).toBe("iss_102");
  });

  it("records a duplicate answer of none with no issue id", async () => {
    const f = fixture("charged-twice");

    const judgment = await createJevProvider({ client: client(replay(f)) }).judge(f.input);

    expect(judgment.answers.duplicate).toMatchObject({ choice: "none", issueId: null });
  });

  it("reads yes/no answers as the probability of yes", async () => {
    const f = fixture("on-prem-request");

    const judgment = await createJevProvider({ client: client(replay(f)) }).judge(f.input);

    expect(judgment.answers.nonGoals.self_hosting).toBeGreaterThan(0.9);
    expect(judgment.answers.dataLoss).toBeLessThan(0.1);
  });

  it("asks for the pinned model", async () => {
    const f = fixture("charged-twice");
    const sent: unknown[] = [];

    await createJevProvider({ client: client(capture(f, sent)) }).judge(f.input);

    expect(JEV_MODEL).toBe("jev-1.13.0");
    expect(requestBody.parse(sent[0]).model).toBe("jev-1.13.0");
  });

  it("sends the ticket text only in the state, never in the questions", async () => {
    const f = fixture("charged-twice");
    const marker = "ZQX-ticket-text-7731";
    const sent: unknown[] = [];
    const input = {
      ...f.input,
      ticket: {
        subject: `Refund ${marker}`,
        messages: [{ from: "customer" as const, text: `Please refund ${marker}.` }],
      },
    };

    await createJevProvider({ client: client(capture(f, sent)) }).judge(input);

    const body = requestBody.parse(sent[0]);
    expect(JSON.stringify(body.state)).toContain(marker);
    expect(JSON.stringify(body.questions)).not.toContain(marker);
  });

  it("retries a rate limit, then succeeds", async () => {
    const f = fixture("charged-twice");
    let calls = 0;
    const fetch: Fetch = async (url, init) => {
      calls++;
      if (calls === 1) {
        return Response.json(
          { error: "rate limited" },
          {
            status: 429,
            headers: { "retry-after-ms": "1" },
          },
        );
      }
      return replay(f)(url, init);
    };

    const judgment = await createJevProvider({ client: client(fetch) }).judge(f.input);

    expect(calls).toBe(2);
    expect(judgment.answers.type.choice).toBe("account_billing");
  });

  it("rejects a refused key with an error that isn't retried", async () => {
    const f = fixture("charged-twice");
    let calls = 0;
    const fetch: Fetch = async () => {
      calls++;
      return Response.json({ error: "invalid api key" }, { status: 401 });
    };

    const error: unknown = await createJevProvider({ client: client(fetch) })
      .judge(f.input)
      .catch((e: unknown) => e);

    expect(calls).toBe(1);
    expect(isRetryableJevError(error)).toBe(false);
  });

  it("rejects a response that doesn't answer every question, without retrying", async () => {
    const f = fixture("charged-twice");
    const body = z
      .object({ answers: z.record(z.string(), z.unknown()) })
      .loose()
      .parse(f.response.body);
    const { area: _dropped, ...answers } = body.answers;
    let calls = 0;
    const fetch: Fetch = async () => {
      calls++;
      return Response.json({ ...body, answers });
    };

    const error: unknown = await createJevProvider({ client: client(fetch) })
      .judge(f.input)
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(z.ZodError);
    expect(isRetryableJevError(error)).toBe(false);
    expect(calls).toBe(1);
  });

  it("gives each attempt 20 seconds and keeps the SDK's default retry", () => {
    const jev = createJevClient({ apiKey: "test-key" });

    expect(jev.timeout).toBe(20_000);
    expect(jev.retry.maxRetries).toBe(2);
    expect([...jev.retry.httpStatuses]).toEqual(expect.arrayContaining([408, 429, 500, 503]));
  });
});

function client(fetch: Fetch) {
  return createJevClient({ apiKey: "test-key", fetch });
}

// Answers only the exact request the fixture was recorded for.
function replay(f: JevFixture): Fetch {
  return async (url, init) => {
    expect(new URL(url).pathname).toBe(f.request.path);
    expect(parseBody(init), "fixture is stale: run `pnpm jev:smoke --record`").toEqual(
      f.request.body,
    );
    return respond(f);
  };
}

// Answers any request with the fixture's response, keeping what was sent.
function capture(f: JevFixture, sent: unknown[]): Fetch {
  return async (_url, init) => {
    sent.push(parseBody(init));
    return respond(f);
  };
}

function respond(f: JevFixture): Response {
  return new Response(JSON.stringify(f.response.body), {
    status: f.response.status,
    headers: f.response.headers,
  });
}

function parseBody(init: RequestInit | undefined): unknown {
  return JSON.parse(z.string().parse(init?.body));
}
