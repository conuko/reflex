import { appendFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { RunHeader } from "@/lib/eval/runner";
import type { EvalItem } from "@/lib/eval/sets";
import type { JudgmentProvider } from "@/lib/judgment/provider";

import { readRun, recordTestRun, runEval, RunMismatchError } from "@/lib/eval/runner";
import { createFakeProvider } from "@/lib/judgment/fake-provider";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function resultsFile(): string {
  const dir = mkdtempSync(join(tmpdir(), "reflex-eval-run-"));
  dirs.push(dir);
  return join(dir, "dev-fake.jsonl");
}

const items: EvalItem[] = Array.from({ length: 5 }, (_, i) => ({
  id: `support-0${i + 1}`,
  set: "support",
  tracker: "librechat",
  createdAt: "2026-09-30T10:00:00Z",
  ticket: {
    subject: `Ticket ${i + 1}`,
    messages: [{ from: "customer", text: `Message ${i + 1}` }],
  },
  gold: {
    type: "bug",
    area: "chat",
    priority: "low",
    duplicateOf: null,
    nonGoal: null,
    signals: null,
    attackTarget: null,
  },
}));

const header: RunHeader = {
  kind: "run",
  part: "dev",
  provider: "fake",
  condition: "no-candidates",
  questionSetVersion: "v1",
  questionSetHash: "abc",
  splitVersion: "v1",
  startedAt: "2026-10-05T10:00:00Z",
};

describe("runEval", () => {
  it("writes the run's header and one line per judged item", async () => {
    const file = resultsFile();
    const fake = createFakeProvider();

    const outcome = await runEval({ file, header, items, provider: fake });

    expect(outcome).toEqual({ skipped: 0, finished: 5, failed: [] });
    expect(fake.calls).toBe(5);
    const run = readRun(file);
    expect(run?.header).toEqual(header);
    expect(run?.items.map(({ id }) => id).toSorted()).toEqual(items.map(({ id }) => id));
    expect(run?.items[0]?.judgment).toMatchObject({ provider: "fake", questionSetVersion: "v1" });
  });

  it("resumes a stopped run without asking for finished items again", async () => {
    const file = resultsFile();
    const controller = new AbortController();
    let results = 0;

    const first = await runEval({
      file,
      header,
      items,
      provider: createFakeProvider(),
      concurrency: 1,
      signal: controller.signal,
      onResult: () => {
        if (++results === 3) controller.abort();
      },
    });
    const fake = createFakeProvider();
    const second = await runEval({
      file,
      header: { ...header, startedAt: "later" },
      items,
      provider: fake,
    });

    expect(first.finished).toBe(3);
    expect(second).toEqual({ skipped: 3, finished: 2, failed: [] });
    expect(fake.calls).toBe(2);
    expect(new Set(readRun(file)?.items.map(({ id }) => id)).size).toBe(5);
  });

  it.each(["questionSetHash", "provider", "condition", "splitVersion", "part"] as const)(
    "refuses to resume a file with a different %s",
    async (key) => {
      const file = resultsFile();
      await runEval({ file, header, items: items.slice(0, 1), provider: createFakeProvider() });

      const changed = { ...header, [key]: key === "part" ? "test" : "other" } as RunHeader;

      await expect(
        runEval({ file, header: changed, items, provider: createFakeProvider() }),
      ).rejects.toThrow(RunMismatchError);
    },
  );

  it("drops a half-written last line and asks for that item again", async () => {
    const file = resultsFile();
    await runEval({ file, header, items: items.slice(0, 2), provider: createFakeProvider() });
    appendFileSync(file, '{"kind":"item","id":"support-03","ms":1,"judg');

    const fake = createFakeProvider();
    const outcome = await runEval({ file, header, items, provider: fake });

    expect(outcome).toEqual({ skipped: 2, finished: 3, failed: [] });
    expect(readFileSync(file, "utf8").split("\n").filter(Boolean)).toHaveLength(6);
  });

  it("records a failed item, keeps going, and retries only that item next time", async () => {
    const file = resultsFile();
    const fake = createFakeProvider();
    const flaky: JudgmentProvider = {
      id: "fake",
      judge: (input, options) =>
        input.ticket.subject === "Ticket 2"
          ? Promise.reject(new Error("rate limited"))
          : fake.judge(input, options),
    };

    const first = await runEval({ file, header, items, provider: flaky });
    const retry = createFakeProvider();
    const second = await runEval({ file, header, items, provider: retry });

    expect(first.failed).toEqual([{ id: "support-02", error: "rate limited" }]);
    expect(first.finished).toBe(4);
    expect(retry.calls).toBe(1);
    expect(second.finished).toBe(1);
  });
});

describe("recordTestRun", () => {
  it("counts every test run", () => {
    const dir = mkdtempSync(join(tmpdir(), "reflex-eval-test-runs-"));
    dirs.push(dir);

    expect(recordTestRun(dir, { run: "test-jev-v1", header })).toBe(1);
    expect(recordTestRun(dir, { run: "test-jev-v1-again", header })).toBe(2);
  });
});
