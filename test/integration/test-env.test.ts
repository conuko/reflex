import { connect } from "node:net";
import { describe, expect, it } from "vitest";

import { webEnv, workerEnv } from "@/lib/env";

function canConnect(url: string): Promise<boolean> {
  const { hostname, port } = new URL(url);
  return new Promise((resolve) => {
    const socket = connect({ host: hostname, port: Number(port) });
    socket.setTimeout(2000);
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("timeout", () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("error", () => resolve(false));
  });
}

describe("integration test env", () => {
  it("points at the test database, Redis db 1 and the fake provider", () => {
    const env = workerEnv();

    expect(new URL(env.DATABASE_URL).pathname).toBe("/reflex_test");
    expect(new URL(env.REDIS_URL).pathname).toBe("/1");
    expect(env.JUDGMENT_PROVIDER).toBe("fake");
    expect(env).not.toHaveProperty("TYPESAFE_API_KEY");
  });

  it("has a valid web env", () => {
    expect(() => webEnv()).not.toThrow();
  });

  it("reaches Postgres and Redis from docker compose", async () => {
    const env = workerEnv();

    expect(await canConnect(env.DATABASE_URL)).toBe(true);
    expect(await canConnect(env.REDIS_URL)).toBe(true);
  });
});
