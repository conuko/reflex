import { existsSync } from "node:fs";
import { defineConfig } from "prisma/config";

// Plain process.env, not Prisma's throwing env(): `prisma generate` (run by
// postinstall) never needs a database. `.env` is loaded only when it exists;
// tests and CI set their URLs themselves.
if (existsSync(".env")) process.loadEnvFile(".env");

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: {
    url: process.env.DATABASE_URL,
    shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL,
  },
});
