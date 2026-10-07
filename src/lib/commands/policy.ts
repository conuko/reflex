import type { Db } from "@/lib/db";
import type { Policy } from "@/lib/policy-schema";
import type { Queues } from "@/lib/queues";
import type { PolicyDiff } from "@/lib/recompute";

import { currentPolicy } from "@/lib/policies";
import { policySchema } from "@/lib/policy-schema";
import { enqueueRecompute } from "@/lib/queues";
import { diffPolicies, loadPolicyRows } from "@/lib/recompute";

// The commands behind the policy editor (plan M4, UI in M5). Both validate the
// policy with its zod schema and answer with field-level errors. Preview is
// read-only: it runs the policy in memory over every ticket's stored
// judgment. Save adds the next version and queues the recompute, which moves
// exactly the tickets the preview listed.

/** Messages per field path, e.g. `featureDemand.mediumArr`. */
export type FieldErrors = Record<string, string[]>;

export type PolicyPreview = Omit<PolicyDiff, "moved"> & {
  fromVersion: number;
  movedCount: number;
  /** The first moved tickets, for the editor to show. */
  samples: PolicyDiff["moved"];
};

const SAMPLES = 10;

export async function previewPolicy(
  database: Db,
  values: unknown,
): Promise<{ ok: false; errors: FieldErrors } | { ok: true; preview: PolicyPreview }> {
  const parsed = validate(values);
  if (!parsed.ok) return parsed;
  const current = await currentPolicy(database);
  const { moved, ...diff } = diffPolicies(
    await loadPolicyRows(database),
    current.values,
    parsed.policy,
  );
  return {
    ok: true,
    preview: {
      ...diff,
      fromVersion: current.version,
      movedCount: moved.length,
      samples: moved.slice(0, SAMPLES),
    },
  };
}

export async function savePolicy(
  { db: database, queues }: { db: Db; queues: Pick<Queues, "recompute"> },
  values: unknown,
): Promise<{ ok: false; errors: FieldErrors } | { ok: true; version: number }> {
  const parsed = validate(values);
  if (!parsed.ok) return parsed;
  const { version: latest } = await currentPolicy(database);
  // The version is the primary key: two saves at once can't both take it.
  const { version } = await database.policy.create({
    data: { version: latest + 1, values: parsed.policy },
    select: { version: true },
  });
  await enqueueRecompute(queues, { reason: "policy", policyVersion: version });
  return { ok: true, version };
}

function validate(
  values: unknown,
): { ok: false; errors: FieldErrors } | { ok: true; policy: Policy } {
  const result = policySchema.safeParse(values);
  if (result.success) return { ok: true, policy: result.data };
  const errors: FieldErrors = {};
  for (const issue of result.error.issues) {
    const path = issue.path.join(".") || "(policy)";
    errors[path] = [...(errors[path] ?? []), issue.message];
  }
  return { ok: false, errors };
}
