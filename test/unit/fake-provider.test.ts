import { describe, expect, it } from "vitest";

import type { JudgmentInput } from "@/lib/judgment/provider";

import { NON_GOALS } from "@/lib/config/non-goals";
import { createFakeProvider } from "@/lib/judgment/fake-provider";
import { AREAS, QUESTION_SET_VERSION, REACHES, TICKET_TYPES } from "@/lib/triage/questions";

const input: JudgmentInput = {
  ticket: {
    subject: "Agents stopped running",
    messages: [{ from: "customer", text: "Every agent run fails since this morning." }],
  },
  candidates: [
    { issueId: "iss_1", title: "Agent runs time out", excerpt: "Runs stop.", state: "open" },
    { issueId: "iss_2", title: "Slack posts twice", excerpt: "Duplicates.", state: "closed" },
  ],
};

describe("fake judgment provider", () => {
  it("gives the same judgment for the same input, across instances", async () => {
    const first = await createFakeProvider().judge(input);
    const second = await createFakeProvider().judge(input);

    expect(second).toEqual(first);
  });

  it("gives different tickets different answers", async () => {
    const fake = createFakeProvider();
    const subjects = ["Login fails", "Export to CSV?", "Charged twice", "SSO loop", "Slow chat"];

    const judgments = await Promise.all(
      subjects.map((subject) => fake.judge({ ...input, ticket: { ...input.ticket, subject } })),
    );

    expect(new Set(judgments.map((j) => JSON.stringify(j.answers))).size).toBe(5);
  });

  it("counts its calls", async () => {
    const fake = createFakeProvider();

    await fake.judge(input);
    await fake.judge(input);

    expect(fake.calls).toBe(2);
  });

  it("answers every question in the set", async () => {
    const judgment = await createFakeProvider().judge(input);

    expect(TICKET_TYPES).toContain(judgment.answers.type.choice);
    expect(AREAS).toContain(judgment.answers.area.choice);
    expect(REACHES).toContain(judgment.answers.reach.choice);
    expect(Object.keys(judgment.answers.nonGoals)).toEqual(NON_GOALS.map((g) => g.id));
    expect(["iss_1", "iss_2", null]).toContain(judgment.answers.duplicate?.issueId);
  });

  it("records the state, candidate map, version and message count like any judgment", async () => {
    const judgment = await createFakeProvider().judge(input);

    expect(judgment).toMatchObject({
      provider: "fake",
      model: "fake",
      questionSetVersion: QUESTION_SET_VERSION,
      messageCount: 1,
      state: { ticket: { subject: "Agents stopped running" } },
      candidateMap: { c1: "iss_1", c2: "iss_2" },
    });
  });

  it("has no duplicate answer when no candidates were offered", async () => {
    const judgment = await createFakeProvider().judge({ ...input, candidates: [] });

    expect(judgment.answers.duplicate).toBeNull();
  });
});
