import { describe, expect, it } from "vitest";

import { EvalArgsError, parseEvalArgs } from "@/lib/eval/cli-args";

describe("parseEvalArgs", () => {
  it("runs Jev on the given part and reports type and area by default", () => {
    expect(parseEvalArgs(["--part", "dev"])).toEqual({
      part: "dev",
      provider: "jev",
      only: ["type", "area"],
      run: null,
      concurrency: 4,
    });
  });

  it("reads every option", () => {
    expect(
      parseEvalArgs([
        "--part=dev",
        "--provider=fake",
        "--only=area,area",
        "--run=dev-try.2",
        "--concurrency=1",
      ]),
    ).toEqual({ part: "dev", provider: "fake", only: ["area"], run: "dev-try.2", concurrency: 1 });
  });

  it("refuses the test part unless it is confirmed", () => {
    expect(() => parseEvalArgs(["--part", "test"])).toThrow("--confirm-test");
    expect(parseEvalArgs(["--part", "test", "--confirm-test"]).part).toBe("test");
  });

  it.each([
    ["no part", []],
    ["an unknown part", ["--part", "train"]],
    ["an unknown provider", ["--part", "dev", "--provider", "qwen"]],
    ["an unknown question", ["--part", "dev", "--only", "type,priority"]],
    ["a concurrency of 0", ["--part", "dev", "--concurrency", "0"]],
    ["a concurrency above 16", ["--part", "dev", "--concurrency", "17"]],
    ["a run name with a path", ["--part", "dev", "--run", "../x"]],
    ["an unknown option", ["--part", "dev", "--fast"]],
  ])("rejects %s", (_, argv) => {
    expect(() => parseEvalArgs(argv)).toThrow(EvalArgsError);
  });
});
