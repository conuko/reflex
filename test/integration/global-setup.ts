import type { TestProject } from "vitest/node";

import { execFileSync } from "node:child_process";

// Brings the test database up to the committed migrations before any
// integration test runs. Only ever the test database: the URL comes from the
// Vitest config, never from `.env`.

export default function setup(project: TestProject) {
  const url = project.config.env.DATABASE_URL;
  if (!url || new URL(url).pathname !== "/reflex_test") {
    throw new Error(`Refusing to migrate ${url ?? "(no DATABASE_URL)"}: not the test database`);
  }
  execFileSync("pnpm", ["exec", "prisma", "migrate", "deploy"], {
    env: { ...process.env, DATABASE_URL: url, PRISMA_HIDE_UPDATE_MESSAGE: "1" },
    stdio: "pipe",
  });
}
