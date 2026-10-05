import { defineConfig } from "vitest/config";

// Tests never read `.env`: every variable a test can see is set here, so a test
// can't spend model tokens or touch dev data. The key is blanked explicitly in
// case the shell exports it.
const testEnv = {
  DATABASE_URL: "postgresql://reflex:reflex@localhost:5433/reflex_test",
  REDIS_URL: "redis://localhost:6380/1",
  JUDGMENT_PROVIDER: "fake",
  INTAKE_WEBHOOK_SECRET: "test-intake-webhook-secret-0123456789abcdef",
  TYPESAFE_API_KEY: "",
};

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    env: testEnv,
    projects: [
      {
        extends: true,
        test: { name: "unit", include: ["test/unit/**/*.test.ts"] },
      },
      {
        extends: true,
        test: {
          name: "integration",
          include: ["test/integration/**/*.test.ts"],
          // Migrates the test database first; files share it, so they run one at a time.
          globalSetup: ["test/integration/global-setup.ts"],
          fileParallelism: false,
        },
      },
    ],
  },
});
