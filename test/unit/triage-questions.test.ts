import { describe, expect, it } from "vitest";

import type { Candidate } from "@/lib/triage/questions";

import { NON_GOALS } from "@/lib/config/non-goals";
import { buildQuestions, QUESTION_SET_VERSION } from "@/lib/triage/questions";

const candidates: Candidate[] = [
  {
    issueId: "iss_101",
    title: "SAML SSO login loops back to the sign-in page",
    excerpt: "Okta users are redirected to the login page after authenticating.",
    state: "open",
  },
  {
    issueId: "iss_102",
    title: "PDF uploads over 20 MB fail silently",
    excerpt: "The knowledge library accepts the file but it never appears.",
    state: "closed",
  },
];

describe("buildQuestions", () => {
  it("asks the fixed questions, the duplicate question and one question per non-goal", () => {
    const { questions } = buildQuestions({ candidates, nonGoals: NON_GOALS });

    expect(Object.keys(questions)).toEqual([
      "type",
      "area",
      "reach",
      "blocked",
      "workaround",
      "data_exposure",
      "data_loss",
      "regression",
      "frustration",
      "duplicate_of",
      "nongoal_self_hosting",
      "nongoal_native_mobile_apps",
      "nongoal_media_generation",
      "injection",
    ]);
  });

  it("offers each candidate as an option, plus none", () => {
    const { questions } = buildQuestions({ candidates, nonGoals: NON_GOALS });

    expect(questions.duplicate_of).toMatchObject({
      type: "choice",
      criteria: {
        c1: {
          title: "SAML SSO login loops back to the sign-in page",
          excerpt: "Okta users are redirected to the login page after authenticating.",
          state: "open",
        },
        c2: { title: "PDF uploads over 20 MB fail silently", state: "closed" },
        none: expect.anything(),
      },
    });
  });

  it("maps each option key to its candidate's issue id", () => {
    const { candidateMap } = buildQuestions({ candidates, nonGoals: NON_GOALS });

    expect(candidateMap).toEqual({ c1: "iss_101", c2: "iss_102" });
  });

  it("caps each candidate's title and excerpt", () => {
    const long = { ...candidates[0], title: "t".repeat(1_000), excerpt: "e".repeat(5_000) };

    const { questions } = buildQuestions({ candidates: [long], nonGoals: NON_GOALS });

    expect(questions.duplicate_of?.criteria).toMatchObject({
      c1: {
        title: expect.stringMatching(/^t{199}…$/),
        excerpt: expect.stringMatching(/^e{499}…$/),
      },
    });
  });

  it("refuses more than 10 candidates", () => {
    const eleven = Array.from({ length: 11 }, (_, i) => ({
      ...candidates[0],
      issueId: `iss_${i}`,
    }));

    expect(() => buildQuestions({ candidates: eleven, nonGoals: NON_GOALS })).toThrow(
      "at most 10 candidates",
    );
  });

  it("leaves out the duplicate question when there are no candidates", () => {
    const { questions, candidateMap } = buildQuestions({ candidates: [], nonGoals: NON_GOALS });

    expect(questions).not.toHaveProperty("duplicate_of");
    expect(candidateMap).toEqual({});
  });

  it("puts each non-goal's text in its question's instructions", () => {
    const { questions } = buildQuestions({ candidates, nonGoals: NON_GOALS });

    expect(JSON.stringify(questions.nongoal_self_hosting?.instructions)).toContain(
      "on-premises, self-hosted, offline or air-gapped edition",
    );
  });

  it("matches the frozen text of its version", async () => {
    // Fails when question text changes without a QUESTION_SET_VERSION bump. To
    // change a question, bump the version; the new version gets its own file.
    const set = buildQuestions({ candidates, nonGoals: NON_GOALS }).questions;

    await expect(JSON.stringify(set, null, 2)).toMatchFileSnapshot(
      `../fixtures/question-sets/${QUESTION_SET_VERSION}.json`,
    );
  });
});
