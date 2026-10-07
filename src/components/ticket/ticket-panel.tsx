"use client";

import type { ReactNode } from "react";

import { cn } from "cn";
import { Check, X } from "lucide-react";

import type { TriagePriority } from "@/lib/priorities";
import type { TicketDetail } from "@/lib/reads/ticket";

import { formatDateTime } from "@/components/format";
import { PriorityIcon, PriorityLabel } from "@/components/priority";
import { IssueLinks } from "@/components/ticket/issue-links";
import { Signals } from "@/components/ticket/signals";
import { WhyPriority } from "@/components/ticket/why-priority";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { formatUsd, labelOf, PLAN_LABELS, PRIORITY_KEYS, PRIORITY_LABELS } from "@/lib/labels";
import { TRIAGE_PRIORITIES } from "@/lib/priorities";

// The detail panel (plan M5), used by the inbox and Try it: the priority and
// its explanation, routing and flags, duplicates, the thread and what people
// changed.

const SOURCE_LABELS: Record<string, string> = {
  seed: "Demo data",
  intake: "Intake",
  try_it: "Try it",
};

export function TicketPanel({
  detail,
  onClose,
  onSetPriority,
  onAccept,
  extra,
}: {
  detail: TicketDetail;
  onClose?: () => void;
  onSetPriority: (priority: TriagePriority) => void;
  onAccept: () => void;
  /** Rendered under the priority, e.g. Try it's signal diff. */
  extra?: ReactNode;
}) {
  return (
    <article className="space-y-5 p-5" aria-labelledby="ticket-subject">
      <header className="space-y-2">
        <div className="flex items-start justify-between gap-3">
          <h2 id="ticket-subject" className="text-lg leading-snug font-semibold">
            {detail.subject}
          </h2>
          {onClose && (
            <Button variant="ghost" size="icon-sm" aria-label="Close" onClick={onClose}>
              <X />
            </Button>
          )}
        </div>
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">{detail.workspace.name}</span>
          <Badge variant="secondary">{PLAN_LABELS[detail.workspace.plan]}</Badge>
          <span>{formatUsd(detail.workspace.arr)} ARR</span>
          <span>·</span>
          <span>{detail.workspace.tracker}</span>
          <span>·</span>
          <span suppressHydrationWarning>{formatDateTime(detail.createdAt)}</span>
          <Badge variant="outline">{SOURCE_LABELS[detail.source] ?? detail.source}</Badge>
        </p>
      </header>

      <PriorityControl detail={detail} onSetPriority={onSetPriority} onAccept={onAccept} />
      {extra}

      {detail.triaging && (
        <div className="space-y-2" aria-live="polite">
          <p className="text-sm text-muted-foreground">
            {detail.triage
              ? "A new message arrived; Jev is reading the whole thread again."
              : "Jev is reading the ticket."}
          </p>
          {!detail.triage && <Skeleton className="h-24 w-full" />}
        </div>
      )}
      <WhyPriority detail={detail} />
      <Separator />
      <Signals detail={detail} />
      <Separator />
      <IssueLinks detail={detail} />
      <Separator />
      <Thread detail={detail} />
      {detail.corrections.length > 0 && (
        <>
          <Separator />
          <Corrections detail={detail} />
        </>
      )}
    </article>
  );
}

function PriorityControl({
  detail,
  onSetPriority,
  onAccept,
}: {
  detail: TicketDetail;
  onSetPriority: (priority: TriagePriority) => void;
  onAccept: () => void;
}) {
  return (
    <div className="space-y-2">
      <fieldset className="flex flex-wrap items-center gap-1">
        <legend className="sr-only">Priority</legend>
        {TRIAGE_PRIORITIES.map((priority) => (
          <Button
            key={priority}
            variant={detail.priority === priority ? "secondary" : "ghost"}
            size="sm"
            aria-pressed={detail.priority === priority}
            className={cn(detail.priority === priority && "ring-1 ring-foreground/20")}
            onClick={() => onSetPriority(priority)}
          >
            <PriorityIcon priority={priority} />
            {PRIORITY_LABELS[priority]}
            <Kbd className="ml-0.5">{PRIORITY_KEYS[priority]}</Kbd>
          </Button>
        ))}
      </fieldset>
      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
        {detail.humanSet ? (
          <span>
            Set by a person; the policy suggests {labelOf(PRIORITY_LABELS, detail.suggested)}.
          </span>
        ) : detail.suggested ? (
          <span className="inline-flex items-center gap-1">
            Suggested by the policy: <PriorityLabel priority={detail.suggested} />
          </span>
        ) : null}
        {detail.accepted ? (
          <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400">
            <Check className="size-3.5" /> Checked by a person
          </span>
        ) : (
          detail.triage && (
            <Button variant="outline" size="xs" onClick={onAccept}>
              <Check /> Accept <Kbd>a</Kbd>
            </Button>
          )
        )}
      </div>
    </div>
  );
}

function Thread({ detail }: { detail: TicketDetail }) {
  return (
    <section aria-labelledby="thread" className="space-y-3">
      <h3 id="thread" className="text-sm font-semibold">
        Thread
      </h3>
      <ol className="space-y-3">
        {detail.messages.map((message) => (
          <li key={message.position} className="rounded-md border px-3 py-2 text-sm">
            <p className="mb-1 flex justify-between text-xs text-muted-foreground">
              <span className="font-medium">
                {message.from === "support" ? "Support" : "Customer"}
              </span>
              <span suppressHydrationWarning>{formatDateTime(message.createdAt)}</span>
            </p>
            <p className="break-words whitespace-pre-wrap">{message.text}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

function Corrections({ detail }: { detail: TicketDetail }) {
  return (
    <section aria-labelledby="corrections" className="space-y-2">
      <h3 id="corrections" className="text-sm font-semibold">
        Changed by people
      </h3>
      <ul className="space-y-1 text-xs text-muted-foreground">
        {detail.corrections.map((correction) => (
          <li key={`${correction.createdAt}-${correction.field}`} suppressHydrationWarning>
            {formatDateTime(correction.createdAt)}: {correction.field}{" "}
            {correctionValue(correction.field, correction.fromValue)} →{" "}
            {correctionValue(correction.field, correction.toValue)}
          </li>
        ))}
      </ul>
    </section>
  );
}

function correctionValue(field: string, value: string | null): string {
  if (value === null || value === "none") return "none";
  return field === "priority" ? labelOf(PRIORITY_LABELS, value) : value;
}

export function TicketPanelSkeleton() {
  return (
    <div className="space-y-4 p-5">
      <Skeleton className="h-6 w-3/4" />
      <Skeleton className="h-4 w-1/2" />
      <Skeleton className="h-40 w-full" />
    </div>
  );
}
