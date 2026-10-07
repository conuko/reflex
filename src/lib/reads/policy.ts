import type { Db } from "@/lib/db";
import type { Policy } from "@/lib/policy-schema";

import { policySchema } from "@/lib/policy-schema";

// The policy editor's version list (plan M5), newest first. The newest is the
// one in force; versions are never edited (ADR-0001).

export type PolicyVersion = { version: number; values: Policy; createdAt: string };

export async function policyVersions(database: Db): Promise<PolicyVersion[]> {
  const versions = await database.policy.findMany({ orderBy: { version: "desc" } });
  return versions.map(({ version, values, createdAt }) => ({
    version,
    values: policySchema.parse(values),
    createdAt: createdAt.toISOString(),
  }));
}
