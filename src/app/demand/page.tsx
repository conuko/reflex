import type { Metadata } from "next";

import { connection } from "next/server";

import { DemandView } from "@/components/demand/demand-view";
import { LiveRefresh } from "@/components/live-events";
import { db } from "@/lib/db";
import { demandOverview } from "@/lib/reads/demand";

export const metadata: Metadata = { title: "Feature demand" };

export default async function DemandPage() {
  await connection();
  const overview = await demandOverview(db());
  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <LiveRefresh />
      <header className="space-y-1">
        <h1 className="text-xl font-semibold">Feature demand</h1>
        <p className="max-w-3xl text-sm text-muted-foreground">
          Which existing issues customers keep running into or asking for, counted from the tickets
          linked to them, by Jev's duplicate pick or by a person. Counting and adding up are plain
          SQL; Jev only says which issue a ticket is about.
        </p>
      </header>
      <DemandView overview={overview} />
    </div>
  );
}
