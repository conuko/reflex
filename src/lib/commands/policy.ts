import type { Db } from "@/lib/db";
import type { Policy } from "@/lib/policy-schema";
import type { TriagePriority } from "@/lib/priorities";
import type { Queues } from "@/lib/queues";
import type { PolicyDiff } from "@/lib/recompute";

import { currentPolicy } from "@/lib/policies";
import { policySchema } from "@/lib/policy-schema";
import { enqueueRecompute } from "@/lib/queues";
import { diffPolicies, loadPolicyRows } from "@/lib/recompute";

import type { FieldErrors } from "./result";

import { fieldErrors } from "./result";

// The commands behind the policy editor (plan M4, UI in M5). Both validate the
// policy with its zod schema and answer with field-level errors. Preview is
// read-only: it runs the policy in memory over every ticket's stored
// judgment. Save adds the next version and queues the recompute, which moves
// exactly the tickets the preview listed.

export type { FieldErrors } from "./result";

export type PolicyPreview = Omit<PolicyDiff, "moved"> & {
  fromVersion: number;
  movedCount: number;
  /** The first moved tickets, for the editor to show. */
  samples: { ticketId: string; subject: string; from: TriagePriority; to: TriagePriority }[];
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
  const samples = moved.slice(0, SAMPLES);
  const subjects = new Map(
    (
      await database.ticket.findMany({
        where: { id: { in: samples.map(({ ticketId }) => ticketId) } },
        select: { id: true, subject: true },
      })
    ).map(({ id, subject }) => [id, subject]),
  );
  return {
    ok: true,
    preview: {
      ...diff,
      fromVersion: current.version,
      movedCount: moved.length,
      samples: samples.map((move) =>
        Object.assign(move, { subject: subjects.get(move.ticketId) ?? "" }),
      ),
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
  return { ok: false, errors: fieldErrors(result.error) };
}
