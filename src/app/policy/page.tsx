import type { Metadata } from "next";

import { connection } from "next/server";

import { LiveRefresh } from "@/components/live-events";
import { PolicyEditor } from "@/components/policy/policy-editor";
import { db } from "@/lib/db";
import { ensureFirstPolicy } from "@/lib/policies";
import { policyVersions } from "@/lib/reads/policy";

export const metadata: Metadata = { title: "Policy" };

export default async function PolicyPage() {
  await connection();
  const database = db();
  let versions = await policyVersions(database);
  if (versions.length === 0) {
    await ensureFirstPolicy(database);
    versions = await policyVersions(database);
  }
  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <LiveRefresh />
      <header className="space-y-1">
        <h1 className="text-xl font-semibold">Policy</h1>
        <p className="max-w-3xl text-sm text-muted-foreground">
          Jev answers questions about each ticket; this policy turns the answers, the workspace's
          plan, open incidents and feature demand into a priority (ADR-0001). Changing it asks Jev
          nothing: every ticket is recomputed from its stored judgment.
        </p>
      </header>
      <PolicyEditor versions={versions} />
    </div>
  );
}
