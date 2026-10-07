import type { TicketDetail } from "@/lib/reads/ticket";

import { ProbabilityBar } from "@/components/ticket/why-priority";
import {
  AREA_LABELS,
  FRUSTRATION_LABELS,
  labelOf,
  nonGoalLabel,
  REACH_LABELS,
  SQUAD_LABELS,
  TYPE_LABELS,
} from "@/lib/labels";
import { percent } from "@/lib/triage/explain";

// Routing and flags: where the ticket goes, and every answer Jev gave, with
// its probability. Only the policy turns these into a priority.

const FLAGS = [
  ["blocked", "Blocked"],
  ["workaround", "Has a workaround"],
  ["regression", "Used to work"],
  ["dataExposure", "Data exposure"],
  ["dataLoss", "Data loss"],
  ["injection", "Tries to instruct the triage"],
] as const;

export function Signals({ detail }: { detail: TicketDetail }) {
  const { judgment, triage } = detail;
  if (!judgment) return null;
  const { answers } = judgment;
  const yes = triage?.policy.yesThreshold ?? 0.5;
  const nonGoals = Object.entries(answers.nonGoals).filter(([, probability]) => probability >= 0.2);

  return (
    <section aria-labelledby="signals" className="space-y-3">
      <h3 id="signals" className="text-sm font-semibold">
        Routing and flags
      </h3>
      <dl className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-1.5 text-sm">
        <dt className="text-muted-foreground">Squad</dt>
        <dd className="font-medium">{labelOf(SQUAD_LABELS, triage?.squad ?? null)}</dd>
        <dt className="text-muted-foreground">Type</dt>
        <dd>
          {TYPE_LABELS[answers.type.choice]}{" "}
          <span className="text-muted-foreground">{percent(answers.type.probability)}</span>
        </dd>
        <dt className="text-muted-foreground">Area</dt>
        <dd>
          {AREA_LABELS[answers.area.choice]}{" "}
          <span className="text-muted-foreground">{percent(answers.area.probability)}</span>
        </dd>
        <dt className="text-muted-foreground">Reach</dt>
        <dd>
          {REACH_LABELS[answers.reach.choice]}{" "}
          <span className="text-muted-foreground">{percent(answers.reach.probability)}</span>
        </dd>
        <dt className="text-muted-foreground">Frustration</dt>
        <dd>{FRUSTRATION_LABELS[Math.round(answers.frustration.score)] ?? "Unknown"}</dd>
      </dl>
      <ul className="space-y-1 text-xs">
        {FLAGS.map(([key, label]) => (
          <li key={key} className="grid grid-cols-[8rem_1fr] items-center gap-3">
            <span className={answers[key] >= yes ? "font-medium" : "text-muted-foreground"}>
              {label}
            </span>
            <ProbabilityBar probability={answers[key]} threshold={yes} />
          </li>
        ))}
        {nonGoals.map(([id, probability]) => (
          <li key={id} className="grid grid-cols-[8rem_1fr] items-center gap-3">
            <span className={probability >= yes ? "font-medium" : "text-muted-foreground"}>
              Asks for: {nonGoalLabel(id)}
            </span>
            <ProbabilityBar probability={probability} threshold={yes} />
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted-foreground">
        One {judgment.provider === "jev" ? "Jev" : judgment.provider} request ({judgment.model},{" "}
        {judgment.inputTokens.toLocaleString("en-US")} input tokens
        {judgment.origin === "eval" ? ", taken from the committed eval results" : ""}).
      </p>
    </section>
  );
}
