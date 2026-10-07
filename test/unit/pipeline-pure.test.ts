import { APIConnectionError, APIError, TypeSafeError } from "@typesafe-ai/sdk";
import { UnrecoverableError } from "bullmq";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { signBody, verifySignature } from "@/lib/commands/intake";
import { estimateTokens } from "@/lib/judgment/rate-limit";
import { detectSpikes, groupKey } from "@/lib/spike";
import { classify } from "@/worker/processors/triage";

import { answers } from "../support/answers";

const now = new Date("2026-10-06T12:10:00Z");
const minutesAgo = (minutes: number) => new Date(now.getTime() - minutes * 60_000);
const rules = { windowMinutes: 30, minTickets: 3 };

describe("detectSpikes", () => {
  it("finds groups with enough tickets in the window, aligned to the window start", () => {
    const tickets = [
      { ticketId: "a1", groupKey: "area:x:agents", createdAt: minutesAgo(1) },
      { ticketId: "a2", groupKey: "area:x:agents", createdAt: minutesAgo(10) },
      { ticketId: "a3", groupKey: "area:x:agents", createdAt: minutesAgo(29) },
      { ticketId: "c1", groupKey: "area:x:chat", createdAt: minutesAgo(2) },
      { ticketId: "c2", groupKey: "area:x:chat", createdAt: minutesAgo(3) },
    ];

    expect(detectSpikes(tickets, now, rules)).toEqual([
      {
        groupKey: "area:x:agents",
        windowStart: new Date("2026-10-06T12:00:00Z"),
        ticketIds: ["a1", "a2", "a3"],
      },
    ]);
  });

  it("ignores tickets older than the window or after now", () => {
    const tickets = [
      { ticketId: "old", groupKey: "g", createdAt: minutesAgo(30) },
      { ticketId: "new1", groupKey: "g", createdAt: minutesAgo(1) },
      { ticketId: "new2", groupKey: "g", createdAt: minutesAgo(2) },
      { ticketId: "future", groupKey: "g", createdAt: minutesAgo(-1) },
    ];

    expect(detectSpikes(tickets, now, rules)).toEqual([]);
  });
});

describe("groupKey", () => {
  it("groups by Jev's duplicate pick, otherwise by tracker and area", () => {
    const duplicate = {
      choice: "c1",
      probability: 0.9,
      probabilities: {},
      issueId: "librechat#2112",
    };

    expect(groupKey(answers({ duplicate }), "librechat")).toBe("issue:librechat#2112");
    expect(groupKey(answers({ area: "agents" }), "lobehub")).toBe("area:lobehub:agents");
  });
});

describe("intake signatures", () => {
  const secret = "s".repeat(32);

  it("accepts the HMAC of the exact body and nothing else", () => {
    const body = '{"a":1}';

    expect(signBody(body, secret)).toMatch(/^sha256=[0-9a-f]{64}$/);
    expect(verifySignature(body, signBody(body, secret), secret)).toBe(true);
    expect(verifySignature(`${body} `, signBody(body, secret), secret)).toBe(false);
    expect(verifySignature(body, signBody(body, "t".repeat(32)), secret)).toBe(false);
    expect(verifySignature(body, "sha256=short", secret)).toBe(false);
    expect(verifySignature(body, null, secret)).toBe(false);
  });
});

function http(status: number) {
  return APIError.fromResponse(status, { error: "test" }, new Headers());
}

describe("classify (triage job errors)", () => {
  it.each([
    ["a rate limit", http(429)],
    ["a server error", http(503)],
    ["a connection failure", new APIConnectionError("socket hang up")],
    ["a database error", new Error("Connection terminated")],
  ])("lets BullMQ retry %s", (_, error) => {
    expect(classify(error)).toBe(error);
  });

  it.each([
    ["a bad request", http(400)],
    ["an authentication error", http(401)],
    ["a missing key", new TypeSafeError("Missing API key")],
    ["a response that doesn't fit", z.object({ a: z.string() }).safeParse({}).error],
  ])("fails %s for good", (_, error) => {
    expect(classify(error)).toBeInstanceOf(UnrecoverableError);
  });
});

describe("estimateTokens", () => {
  it("adds the question set's tokens to about a third of the input's bytes", () => {
    const input = {
      ticket: { subject: "s", messages: [{ from: "customer" as const, text: "x".repeat(3_000) }] },
      candidates: [],
    };

    expect(estimateTokens(input)).toBeGreaterThan(4_500);
    expect(estimateTokens(input)).toBeLessThan(4_600);
  });
});
