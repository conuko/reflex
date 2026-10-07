import { ArrowRight } from "lucide-react";

import type { TicketDetail } from "@/lib/reads/ticket";
import type { SignalChange } from "@/lib/triage/signal-diff";

import {
  AREA_LABELS,
  FRUSTRATION_LABELS,
  labelOf,
  REACH_LABELS,
  signalLabel,
  TYPE_LABELS,
} from "@/lib/labels";
import { percent } from "@/lib/triage/explain";
import { diffSignals } from "@/lib/triage/signal-diff";

// What the last reply changed in Jev's answers (plan M5, Try it): the latest
// judgment against the one before, through the pure diffSignals.

export function SignalDiff({ detail }: { detail: TicketDetail }) {
  const before = detail.judgments.at(-2);
  const after = detail.judgments.at(-1);
  if (!before || !after) return null;
  const changes = diffSignals(before.answers, after.answers, {
    yesThreshold: detail.triage?.policy.yesThreshold ?? 0.5,
  });

  return (
    <section aria-labelledby="signal-diff" className="space-y-2 rounded-md border px-3 py-2">
      <h3 id="signal-diff" className="text-sm font-semibold">
        What the reply changed
      </h3>
      <p className="text-xs text-muted-foreground">
        Jev's answers after {after.messageCount} messages, against those after {before.messageCount}
        .
      </p>
      {changes.length === 0 ? (
        <p className="text-sm">No answer moved.</p>
      ) : (
        <ul className="space-y-1 text-sm">
          {changes.map((change) => (
            <li key={change.signal} className="flex flex-wrap items-center gap-1.5">
              <span className="font-medium">{signalLabel(change.signal)}:</span>
              <Change change={change} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Change({ change }: { change: SignalChange }) {
  const arrow = <ArrowRight className="size-3.5 text-muted-foreground" />;
  if (change.kind === "choice") {
    const labels: Record<string, string> =
      change.signal === "type"
        ? TYPE_LABELS
        : change.signal === "area"
          ? AREA_LABELS
          : REACH_LABELS;
    return (
      <>
        {labelOf(labels, change.from)} ({percent(change.fromProbability)}) {arrow}{" "}
        {labelOf(labels, change.to)} ({percent(change.toProbability)})
      </>
    );
  }
  if (change.kind === "yes_no") {
    return (
      <>
        {percent(change.from)} {arrow} {percent(change.to)}
        {change.became && <span className="font-medium">now {change.became}</span>}
      </>
    );
  }
  if (change.kind === "duplicate") {
    return (
      <>
        {change.from ?? "none"} {arrow} {change.to ?? "none"}
      </>
    );
  }
  return (
    <>
      {FRUSTRATION_LABELS[change.from] ?? change.from} {arrow}{" "}
      {FRUSTRATION_LABELS[change.to] ?? change.to}
    </>
  );
}
