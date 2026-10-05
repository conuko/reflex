import { APIConnectionError, APIError, APITimeoutError, TypeSafeError } from "@typesafe-ai/sdk";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { isRetryableJevError } from "@/lib/judgment/jev-provider";

const httpError = (status: number) =>
  APIError.fromResponse(status, { error: "test" }, new Headers());

describe("isRetryableJevError", () => {
  it.each([
    ["a rate limit (429)", httpError(429)],
    ["a server error (500)", httpError(500)],
    ["a bad gateway (502)", httpError(502)],
    ["an unavailable service (503)", httpError(503)],
    ["an overloaded service (529)", httpError(529)],
    ["a connection failure", new APIConnectionError("socket hang up")],
    ["a timeout", new APITimeoutError(20_000)],
  ])("retries %s", (_name, error) => {
    expect(isRetryableJevError(error)).toBe(true);
  });

  it.each([400, 401, 403, 404, 408, 409, 422])("gives up on HTTP %i", (status) => {
    expect(isRetryableJevError(httpError(status))).toBe(false);
  });

  it("gives up on a client configuration error", () => {
    expect(isRetryableJevError(new TypeSafeError("Missing API key"))).toBe(false);
  });

  it("gives up on a response that doesn't match the question set", () => {
    const error = z.object({ type: z.string() }).safeParse({}).error;

    expect(isRetryableJevError(error)).toBe(false);
  });
});
