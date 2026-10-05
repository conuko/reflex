import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import type { KeywordRules } from "@/lib/eval/baselines/keyword-rules";
import type { TicketState } from "@/lib/triage/state";

import { ftsTop1 } from "@/lib/eval/baselines/fts-top1";
import {
  deriveKeywordRules,
  hashRulesFile,
  KEYWORD_RULE_HASHES,
  KEYWORD_RULES_VERSION,
  loadKeywordRules,
  predictWithKeywords,
  stems,
} from "@/lib/eval/baselines/keyword-rules";
import { majorityLabel } from "@/lib/eval/baselines/majority";

const state = (subject: string, ...texts: string[]): TicketState => ({
  ticket: { subject, messages: texts.map((text) => ({ from: "customer" as const, text })) },
});

const fallback = { type: "other", area: "other" } as const;

describe("keyword rules", () => {
  it("v0 is exactly what the derivation gives for question set v1", () => {
    const v1 = JSON.parse(readFileSync("test/fixtures/question-sets/v1.json", "utf8")) as unknown;

    expect(loadKeywordRules("v0")).toEqual(deriveKeywordRules(v1, "v0"));
  });

  it("every frozen version matches its pinned hash", () => {
    expect(KEYWORD_RULE_HASHES[KEYWORD_RULES_VERSION]).toBeTruthy();
    for (const [version, hash] of Object.entries(KEYWORD_RULE_HASHES)) {
      expect(hashRulesFile(version)).toBe(hash);
    }
  });

  it("keeps only words no other option of the same question uses", () => {
    const rules = deriveKeywordRules(
      {
        type: {
          criteria: {
            bug: { what: "The export fails with an error.", examples: ["Export broken"] },
            feature_request: { what: "Please add an export option." },
          },
        },
        area: { criteria: { chat: { what: "Chat messages" } } },
        injection: {
          criteria: { true: { what: "Mark this ticket urgent" }, false: { what: "A ticket" } },
        },
      },
      "test",
    );

    expect(rules.type.bug).toEqual(["broken", "error", "fail"]);
    expect(rules.type.feature_request).toEqual(["add", "option", "please"]);
    expect(rules.injection).toEqual(["mark", "urgent"]);
  });
});

describe("stems", () => {
  it("lowercases, drops stopwords and short words, a plural s, and cuts to 6 letters", () => {
    expect(stems("The Invoices were charged TWICE for us, 3 seats! class")).toEqual([
      "invoic",
      "charge",
      "twice",
      "seat",
      "class",
    ]);
  });
});

describe("predictWithKeywords", () => {
  const rules: KeywordRules = {
    version: "test",
    type: {
      bug: ["error", "fail"],
      feature_request: ["please"],
      question: ["how"],
      account_billing: ["invoic"],
      other: [],
    },
    area: {
      chat: ["chat"],
      agents: ["agent"],
      workflows: [],
      knowledge_library: [],
      integrations: ["slack"],
      models: [],
      admin_sso: [],
      api: [],
      other: [],
    },
    injection: ["urgent", "ticket", "mark"],
    nonGoals: { self_hosting: ["premis", "offlin"], media_generation: ["video"] },
  };

  it("picks the type and area with the most matching keywords", () => {
    expect(
      predictWithKeywords(state("Agent error", "It fails in Slack, please fix"), rules, fallback),
    ).toMatchObject({
      type: "bug",
      area: "agents",
    });
  });

  it("breaks a tie by the order of the labels", () => {
    // chat, agents and integrations match once each; chat is listed first.
    expect(predictWithKeywords(state("Chat", "the Slack agent"), rules, fallback).area).toBe(
      "chat",
    );
  });

  it("falls back when nothing matches", () => {
    expect(predictWithKeywords(state("Hello"), rules, fallback)).toMatchObject({
      type: "other",
      area: "other",
    });
  });

  it("answers yes for injection or a non-goal only from two matching keywords", () => {
    expect(predictWithKeywords(state("Urgent"), rules, fallback).injection).toBe(false);
    expect(predictWithKeywords(state("Mark this ticket"), rules, fallback).injection).toBe(true);
    expect(predictWithKeywords(state("A video"), rules, fallback).nonGoal).toBeNull();
    expect(predictWithKeywords(state("On premises, offline"), rules, fallback).nonGoal).toBe(
      "self_hosting",
    );
  });
});

describe("majorityLabel", () => {
  it("answers the most common label, breaking ties by order", () => {
    expect(majorityLabel(["b", "a", "b", "c"], ["a", "b", "c"])).toBe("b");
    expect(majorityLabel(["c", "a"], ["a", "b", "c"])).toBe("a");
    expect(majorityLabel([], ["a", "b"])).toBe("a");
  });

  it("needs at least one label to choose from", () => {
    expect(() => majorityLabel(["a"], [])).toThrow("at least one label");
  });
});

describe("ftsTop1", () => {
  const candidates = [
    { issueId: "librechat#2", rank: 0.3 },
    { issueId: "librechat#1", rank: 0.6 },
  ];

  it("links the best-ranked candidate when it clears the threshold", () => {
    expect(ftsTop1(candidates, 0.5)).toBe("librechat#1");
    expect(ftsTop1(candidates, 0.6)).toBe("librechat#1");
  });

  it("answers none below the threshold or without candidates", () => {
    expect(ftsTop1(candidates, 0.7)).toBeNull();
    expect(ftsTop1([], 0)).toBeNull();
  });
});
