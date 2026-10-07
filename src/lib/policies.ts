import type { Db } from "@/lib/db";
import type { Policy } from "@/lib/policy-schema";

import { DEFAULT_POLICY, policySchema } from "@/lib/policy-schema";

// Saved policy versions (ADR-0001). Versions only ever get added; a trigger in
// the database rejects updating one. The latest version is the one in force.

export type SavedPolicy = { version: number; values: Policy };

export async function currentPolicy(database: Db): Promise<SavedPolicy> {
  const latest = await database.policy.findFirst({ orderBy: { version: "desc" } });
  if (latest) return { version: latest.version, values: policySchema.parse(latest.values) };
  return ensureFirstPolicy(database);
}

/** Saves the default policy as version 1 unless a version 1 exists. */
export async function ensureFirstPolicy(database: Db): Promise<SavedPolicy> {
  const first = await database.policy.upsert({
    where: { version: 1 },
    create: { version: 1, values: DEFAULT_POLICY },
    update: {},
  });
  return { version: first.version, values: policySchema.parse(first.values) };
}
