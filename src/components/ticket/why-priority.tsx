import { cn } from "cn";
import { Check, Minus, X } from "lucide-react";

import type { TicketDetail } from "@/lib/reads/ticket";
import type { ExplainedCheck } from "@/lib/triage/explain";

import { PriorityLabel } from "@/components/priority";
import { labelOf, PRIORITY_LABELS, REVIEW_REASON_LABELS } from "@/lib/labels";
import { explainTrace } from "@/lib/triage/explain";

// "Why this priority" (plan M5): the policy's trace, rule by rule, from
// templates. Each yes/no answer is a bar of Jev's probability with the yes
// threshold marked; the rule that fired is highlighted.

export function WhyPriority({ detail }: { detail: TicketDetail }) {
  const { triage } = detail;
  if (!triage) return null;
  const steps = explainTrace(triage.trace, triage.policy);

  return (
    <section aria-labelledby="why-priority" className="space-y-3">
      <div className="flex items-baseline justify-between gap-2">
        <h3 id="why-priority" className="text-sm font-semibold">
          Why this priority
        </h3>
        <span className="text-xs text-muted-foreground">
          Policy v{triage.policyVersion}, from {triage.messageCount} message
          {triage.messageCount === 1 ? "" : "s"}
        </span>
      </div>
      {detail.humanSet && (
        <p className="rounded-md bg-muted px-3 py-2 text-xs">
          A person set {labelOf(PRIORITY_LABELS, detail.priority)}. The policy says{" "}
          {labelOf(PRIORITY_LABELS, triage.priority)}, as explained below; recompute leaves the
          ticket alone.
        </p>
      )}
      <ol className="space-y-1.5">
        {steps.map((step) => (
          <li
            key={step.rule}
            className={cn(
              "rounded-md border px-3 py-2 text-sm",
              step.decisive ? "border-primary/40 bg-primary/5" : "border-transparent bg-muted/40",
            )}
          >
            <div className="flex items-center gap-2">
              {step.decisive ? (
                <Check className="size-4 shrink-0 text-primary" aria-label="Applied" />
              ) : (
                <Minus
                  className="size-4 shrink-0 text-muted-foreground"
                  aria-label="Did not apply"
                />
              )}
              <span className={cn(step.decisive ? "font-medium" : "text-muted-foreground")}>
                {step.title}
              </span>
            </div>
            {step.checks.length > 0 && (
              <ul className="mt-1.5 space-y-1 pl-6">
                {step.checks.map((check) => (
                  <CheckRow key={check.label} check={check} />
                ))}
              </ul>
            )}
          </li>
        ))}
      </ol>
      <div className="flex items-center gap-2 text-sm">
        Result: <PriorityLabel priority={triage.priority} className="font-medium" />
        {triage.previousPriority && triage.previousPriority !== triage.priority && (
          <span className="text-xs text-muted-foreground">
            (was {PRIORITY_LABELS[triage.previousPriority]})
          </span>
        )}
      </div>
      {triage.needsReview && (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-950 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
          <p className="font-medium">Needs review</p>
          <ul className="mt-1 list-disc pl-4">
            {triage.reviewReasons.map((reason) => (
              <li key={reason}>{labelOf(REVIEW_REASON_LABELS, reason)}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function CheckRow({ check }: { check: ExplainedCheck }) {
  const Icon = check.passed ? Check : X;
  return (
    <li className="grid grid-cols-[1rem_8.5rem_1fr] items-center gap-2 text-xs">
      <Icon
        className={cn("size-3.5", check.passed ? "text-emerald-600" : "text-muted-foreground")}
        aria-label={check.passed ? "Met" : "Not met"}
      />
      <span className="truncate">{check.label}</span>
      {check.bar ? (
        <ProbabilityBar
          probability={check.bar.probability}
          threshold={check.bar.threshold}
          detail={check.detail}
          uncertain={check.uncertain}
        />
      ) : (
        <span className="text-muted-foreground">{check.detail}</span>
      )}
    </li>
  );
}

export function ProbabilityBar({
  probability,
  threshold,
  detail,
  uncertain = false,
}: {
  probability: number;
  threshold?: number;
  detail?: string;
  uncertain?: boolean;
}) {
  const percent = Math.round(probability * 100);
  return (
    <span className="flex items-center gap-2">
      <span
        aria-hidden
        className={cn(
          "relative h-2 w-24 shrink-0 overflow-hidden rounded-full bg-muted",
          uncertain && "ring-1 ring-amber-500",
        )}
      >
        <span
          className="absolute inset-y-0 left-0 rounded-full bg-foreground/70"
          style={{ width: `${percent}%` }}
        />
        {threshold !== undefined && (
          <span
            className="absolute inset-y-0 w-px bg-red-500"
            style={{ left: `${Math.round(threshold * 100)}%` }}
          />
        )}
      </span>
      <span className="text-muted-foreground tabular-nums">{detail ?? `${percent}%`}</span>
    </span>
  );
}
