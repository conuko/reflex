"use server";

import { refresh } from "next/cache";

import { previewPolicy, savePolicy } from "@/lib/commands/policy";
import { db } from "@/lib/db";
import { queues } from "@/server/queues";

// Thin adapters over src/lib/commands/policy.ts (plan M5). Preview is
// read-only; save adds a version and queues the recompute, whose end the
// worker announces to every open page.

export async function previewPolicyAction(values: unknown) {
  return previewPolicy(db(), values);
}

export async function savePolicyAction(values: unknown) {
  const result = await savePolicy({ db: db(), queues: queues() }, values);
  if (result.ok) refresh();
  return result;
}
