import { afterEach, describe, expect, it, vi } from "vitest";

import { parseScriptEnv, parseWebEnv, parseWorkerEnv } from "@/lib/env";

const secret = "a".repeat(32);

const web = {
  DATABASE_URL: "postgresql://reflex:reflex@localhost:5433/reflex",
  REDIS_URL: "redis://localhost:6380",
  INTAKE_WEBHOOK_SECRET: secret,
};

const worker = {
  DATABASE_URL: web.DATABASE_URL,
  REDIS_URL: web.REDIS_URL,
  TYPESAFE_API_KEY: "ts-key",
};

describe("parseWebEnv", () => {
  it("returns the required variables", () => {
    expect(parseWebEnv(web)).toEqual(web);
  });

  it.each(["DATABASE_URL", "REDIS_URL", "INTAKE_WEBHOOK_SECRET"])(
    "names %s when it is missing",
    (name) => {
      expect(() => parseWebEnv({ ...web, [name]: undefined })).toThrow(
        `Missing environment variable ${name}`,
      );
    },
  );

  it("treats an empty value as missing", () => {
    expect(() => parseWebEnv({ ...web, REDIS_URL: "" })).toThrow(
      "Missing environment variable REDIS_URL",
    );
  });

  it("names every missing variable at once", () => {
    expect(() => parseWebEnv({})).toThrow(
      /DATABASE_URL[\s\S]*REDIS_URL[\s\S]*INTAKE_WEBHOOK_SECRET/,
    );
  });

  it("rejects an INTAKE_WEBHOOK_SECRET shorter than 32 characters", () => {
    expect(() => parseWebEnv({ ...web, INTAKE_WEBHOOK_SECRET: "a".repeat(31) })).toThrow(
      "INTAKE_WEBHOOK_SECRET must be at least 32 characters",
    );
  });

  it("does not return model keys", () => {
    expect(parseWebEnv({ ...web, TYPESAFE_API_KEY: "ts-key" })).not.toHaveProperty(
      "TYPESAFE_API_KEY",
    );
  });
});

describe("parseWorkerEnv", () => {
  it("defaults JUDGMENT_PROVIDER to jev", () => {
    expect(parseWorkerEnv(worker)).toEqual({ ...worker, JUDGMENT_PROVIDER: "jev" });
  });

  it("requires TYPESAFE_API_KEY when JUDGMENT_PROVIDER is jev", () => {
    expect(() =>
      parseWorkerEnv({ ...worker, JUDGMENT_PROVIDER: "jev", TYPESAFE_API_KEY: undefined }),
    ).toThrow("Missing environment variable TYPESAFE_API_KEY");
  });

  it("requires TYPESAFE_API_KEY when JUDGMENT_PROVIDER is left out", () => {
    expect(() => parseWorkerEnv({ ...worker, TYPESAFE_API_KEY: "" })).toThrow(
      "Missing environment variable TYPESAFE_API_KEY",
    );
  });

  it("does not require TYPESAFE_API_KEY when JUDGMENT_PROVIDER is fake", () => {
    expect(
      parseWorkerEnv({ ...worker, JUDGMENT_PROVIDER: "fake", TYPESAFE_API_KEY: undefined }),
    ).toEqual({
      DATABASE_URL: worker.DATABASE_URL,
      REDIS_URL: worker.REDIS_URL,
      JUDGMENT_PROVIDER: "fake",
    });
  });

  it("drops TYPESAFE_API_KEY when JUDGMENT_PROVIDER is fake", () => {
    expect(parseWorkerEnv({ ...worker, JUDGMENT_PROVIDER: "fake" })).not.toHaveProperty(
      "TYPESAFE_API_KEY",
    );
  });

  it.each(["DATABASE_URL", "REDIS_URL"])("names %s when it is missing", (name) => {
    expect(() => parseWorkerEnv({ ...worker, [name]: undefined })).toThrow(
      `Missing environment variable ${name}`,
    );
  });

  it("names JUDGMENT_PROVIDER when its value is unknown", () => {
    expect(() => parseWorkerEnv({ ...worker, JUDGMENT_PROVIDER: "qwen" })).toThrow(
      'JUDGMENT_PROVIDER must be one of "jev", "fake"',
    );
  });

  it("does not require INTAKE_WEBHOOK_SECRET", () => {
    expect(() => parseWorkerEnv(worker)).not.toThrow();
  });
});

describe("parseScriptEnv", () => {
  it("returns only the variables the script names", () => {
    expect(parseScriptEnv(["TYPESAFE_API_KEY"], { ...web, TYPESAFE_API_KEY: "ts-key" })).toEqual({
      TYPESAFE_API_KEY: "ts-key",
    });
  });

  it("names a missing variable", () => {
    expect(() => parseScriptEnv(["TYPESAFE_API_KEY"], web)).toThrow(
      "Missing environment variable TYPESAFE_API_KEY",
    );
  });

  it("treats an empty value as missing", () => {
    expect(() => parseScriptEnv(["TYPESAFE_API_KEY"], { TYPESAFE_API_KEY: "" })).toThrow(
      "Missing environment variable TYPESAFE_API_KEY",
    );
  });
});

describe("webEnv and workerEnv", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("can be imported with no env set", async () => {
    vi.stubEnv("DATABASE_URL", undefined);
    vi.stubEnv("REDIS_URL", undefined);
    vi.stubEnv("INTAKE_WEBHOOK_SECRET", undefined);
    vi.resetModules();

    const env = await import("@/lib/env");

    expect(() => env.webEnv()).toThrow("Missing environment variable DATABASE_URL");
    expect(() => env.workerEnv()).toThrow("Missing environment variable DATABASE_URL");
  });

  it("parses process.env on first call", async () => {
    vi.resetModules();
    const env = await import("@/lib/env");

    expect(env.webEnv().INTAKE_WEBHOOK_SECRET).toBe(process.env.INTAKE_WEBHOOK_SECRET);
    expect(env.workerEnv().JUDGMENT_PROVIDER).toBe("fake");
  });
});
