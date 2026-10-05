import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "@/generated/prisma/client";
import { scriptEnv } from "@/lib/env";

// The Prisma client on the pg driver adapter (Prisma 7). `db()` makes one per
// process on first use, reading DATABASE_URL only then, and keeps it on
// globalThis so Next's hot reload in dev doesn't open a new pool per change.

export type Db = PrismaClient;

declare global {
  // oxlint-disable-next-line no-var
  var reflexDb: Db | undefined;
}

export function createDb(connectionString: string): Db {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
}

export function db(): Db {
  return (globalThis.reflexDb ??= createDb(scriptEnv("DATABASE_URL").DATABASE_URL));
}
