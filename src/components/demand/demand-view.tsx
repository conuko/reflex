import Link from "next/link";

import type { DemandOverview } from "@/lib/reads/demand";

import { Badge } from "@/components/ui/badge";
import { formatUsd, PLAN_LABELS } from "@/lib/labels";

// The feature demand page (plan M5): per linked issue, how many tickets and
// workspaces ask for it, their plans and ARR, and a 14-day trend; then what
// customers asked for that we won't build, grouped by non-goal.

export function DemandView({ overview }: { overview: DemandOverview }) {
  return (
    <div className="space-y-10">
      <section aria-labelledby="by-issue" className="space-y-3">
        <h2 id="by-issue" className="text-base font-semibold">
          Demand per issue
        </h2>
        {overview.issues.length === 0 ? (
          <p className="text-sm text-muted-foreground">No ticket is linked to an issue yet.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                <tr>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Issue
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    Tickets
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    Workspaces
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Plans
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    ARR
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Last 14 days
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {overview.issues.map((issue) => (
                  <tr key={issue.issueId}>
                    <td className="max-w-md px-3 py-2">
                      <span className="font-mono text-xs">{issue.issueId}</span>{" "}
                      <span>{issue.title}</span>
                      {issue.source === "app" && (
                        <Badge variant="outline" className="ml-2">
                          created here
                        </Badge>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{issue.tickets}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{issue.workspaces}</td>
                    <td className="px-3 py-2">
                      <PlanMix plans={issue.plans} />
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatUsd(issue.arr)}</td>
                    <td className="px-3 py-2">
                      <Sparkline values={issue.trend} label={`${issue.issueId} per day`} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          Each workspace's ARR counts once per issue, however many of its tickets are linked.
          Feature requests linked to an issue take its demand into their priority.
        </p>
      </section>

      <section aria-labelledby="wont-do" className="space-y-3">
        <h2 id="wont-do" className="text-base font-semibold">
          Asked for, but we won't build it
        </h2>
        <div className="grid gap-4 lg:grid-cols-3">
          {overview.wontDo.map((group) => (
            <article key={group.nonGoal} className="space-y-2 rounded-lg border p-4">
              <h3 className="font-medium">{group.label}</h3>
              <p className="text-xs text-muted-foreground">{group.what}</p>
              <p className="text-sm">
                <span className="font-semibold tabular-nums">{group.tickets.length}</span> tickets
                from <span className="tabular-nums">{group.workspaces}</span> workspaces,{" "}
                <span className="tabular-nums">{formatUsd(group.arr)}</span> ARR
              </p>
              <ul className="space-y-1 text-xs">
                {group.tickets.map((ticket) => (
                  <li key={ticket.id} className="flex justify-between gap-2">
                    <Link href={`/inbox?t=${ticket.id}`} className="truncate hover:underline">
                      {ticket.subject}
                    </Link>
                    <span className="shrink-0 text-muted-foreground">
                      {ticket.workspace}, {PLAN_LABELS[ticket.plan]}
                    </span>
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

function PlanMix({ plans }: { plans: Record<keyof typeof PLAN_LABELS, number> }) {
  return (
    <span className="flex flex-wrap gap-1">
      {(["enterprise", "business", "free"] as const).map((plan) =>
        plans[plan] > 0 ? (
          <Badge key={plan} variant={plan === "enterprise" ? "default" : "secondary"}>
            {plans[plan]} {PLAN_LABELS[plan]}
          </Badge>
        ) : null,
      )}
    </span>
  );
}

/** Tickets per day as bars, oldest first. */
export function Sparkline({ values, label }: { values: number[]; label: string }) {
  const max = Math.max(1, ...values);
  const width = 4;
  const gap = 2;
  const height = 20;
  return (
    <>
      <span className="sr-only">{`${label}: ${values.join(", ")}`}</span>
      <svg
        width={values.length * (width + gap)}
        height={height}
        aria-hidden
        className="text-foreground/70"
      >
        {values.map((value, index) => {
          const barHeight = value === 0 ? 1 : Math.max(2, (value / max) * height);
          return (
            <rect
              // Days are positions; they never reorder.
              // oxlint-disable-next-line react/no-array-index-key
              key={index}
              x={index * (width + gap)}
              y={height - barHeight}
              width={width}
              height={barHeight}
              className={value === 0 ? "fill-muted-foreground/30" : "fill-current"}
            />
          );
        })}
      </svg>
    </>
  );
}
