import type { Question, Questions } from "@typesafe-ai/sdk";

import { createHash } from "node:crypto";

import type { JudgmentProvider } from "./provider";

import { judgeTicket } from "./provider";

// The judgment provider for tests: no network, no key, no cost. It builds the
// same state and questions as Jev, makes up a System One response from a hash
// of them, and parses it like a real one. The same input always gets the same
// judgment, and `calls` shows how many judgments were asked for.

export type FakeProvider = JudgmentProvider & { readonly calls: number };

export function createFakeProvider(): FakeProvider {
  let calls = 0;

  return {
    id: "fake",
    get calls() {
      return calls;
    },
    judge(input) {
      calls++;
      return judgeTicket("fake", input, async (request) => {
        const digest = createHash("sha256").update(JSON.stringify(request)).digest();
        return {
          body: fakeResponse(request.questions, digest),
          requestId: `fake-${digest.toString("hex", 0, 8)}`,
        };
      });
    },
  };
}

function fakeResponse(questions: Questions, digest: Buffer) {
  let index = 0;
  // Successive digest bytes as numbers in [0, 1].
  const next = () => (digest[index++ % digest.length] ?? 0) / 255;
  const answers = Object.fromEntries(
    Object.entries(questions).map(([id, question]) => [id, fakeAnswer(question, next)]),
  );
  return { model: "fake", answers, usage: { input_tokens: 0, output_tokens: 0 } };
}

function fakeAnswer(question: Question, next: () => number) {
  if (question.type === "noul") return { type: "noul", noul: next() };

  if (question.type === "choice") {
    const labels = Object.keys(question.criteria);
    const chosen = labels[pick(next(), labels.length)];
    const top = 0.5 + next() / 2;
    const rest = (1 - top) / Math.max(labels.length - 1, 1);
    return {
      type: "choice",
      choice: chosen,
      probabilities: Object.fromEntries(
        labels.map((label) => [label, label === chosen ? top : rest]),
      ),
    };
  }

  const level = pick(next(), question.criteria.length);
  return {
    type: "score",
    score: level,
    probabilities: Object.fromEntries(
      question.criteria.map((_, i) => [String(i), i === level ? 1 : 0]),
    ),
  };
}

function pick(random: number, count: number): number {
  return Math.min(Math.floor(random * count), count - 1);
}
