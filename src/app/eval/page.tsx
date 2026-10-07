import type { Metadata } from "next";

import { cn } from "cn";
import Link from "next/link";

import { EvalView } from "@/components/eval/eval-view";
import { db } from "@/lib/db";
import { evalOverview, evalParts } from "@/lib/reads/eval";

export const metadata: Metadata = { title: "Evaluation" };

const PART_LABELS = { test: "Test (the result)", dev: "Dev (tuning only)" } as const;

export default async function EvalPage({ searchParams }: PageProps<"/eval">) {
  const { part: requested } = await searchParams;
  const database = db();
  const parts = await evalParts(database);
  const part = parts.find((each) => each === requested) ?? parts[0];
  const overview = part ? await evalOverview(database, part) : null;

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <header className="space-y-3">
        <div className="space-y-1">
          <h1 className="text-xl font-semibold">Evaluation</h1>
          <p className="max-w-3xl text-sm text-muted-foreground">
            Jev against hand-written gold labels, next to what plain code does on the same items:
            the majority class, keyword rules and full-text search (ADR-0003). No other model was
            compared. The sets are small, so every number is directional; intervals are 95%.
          </p>
        </div>
        {parts.length > 1 && (
          <nav className="flex gap-1" aria-label="Part">
            {parts.map((each) => (
              <Link
                key={each}
                href={`/eval?part=${each}`}
                aria-current={each === part ? "page" : undefined}
                className={cn(
                  "rounded-md px-2.5 py-1 text-sm text-muted-foreground hover:bg-muted",
                  each === part && "bg-muted font-medium text-foreground",
                )}
              >
                {PART_LABELS[each]}
              </Link>
            ))}
          </nav>
        )}
      </header>
      {overview ? (
        <EvalView overview={overview} />
      ) : (
        <p className="text-sm text-muted-foreground">
          No eval results imported yet. Run <code>pnpm eval:import</code> (or{" "}
          <code>pnpm seed:demo</code>, which runs it too).
        </p>
      )}
    </div>
  );
}
