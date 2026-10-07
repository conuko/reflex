import type { Metadata } from "next";

import { TryIt } from "@/components/try/try-it";
import { db } from "@/lib/db";
import { listWorkspaces } from "@/lib/reads/lookups";
import { ticketDetail } from "@/lib/reads/ticket";

export const metadata: Metadata = { title: "Try it" };

export default async function TryPage({ searchParams }: PageProps<"/try">) {
  const { t } = await searchParams;
  const database = db();
  const [workspaces, initialTicket] = await Promise.all([
    listWorkspaces(database),
    typeof t === "string" && t !== "" ? ticketDetail(database, t) : null,
  ]);
  return (
    <div className="mx-auto max-w-7xl space-y-6 p-6">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold">Try it</h1>
        <p className="max-w-3xl text-sm text-muted-foreground">
          Write a ticket as a customer would. Jev answers the question set once; the policy decides
          the priority from the answers and the workspace. Try a data-loss report, a feature that
          sounds like a non-goal, or a ticket that tells the triage what to do. The next{" "}
          <code>pnpm seed:demo</code> removes these tickets.
        </p>
      </header>
      <TryIt workspaces={workspaces} initialTicket={initialTicket ?? undefined} />
    </div>
  );
}
