import { cn } from "cn";
import Link from "next/link";

import type { EvalItemDetail } from "@/lib/reads/eval";

import { ProbabilityBar } from "@/components/ticket/why-priority";
import { Badge } from "@/components/ui/badge";
import { AREA_LABELS, labelOf, nonGoalLabel, TYPE_LABELS } from "@/lib/labels";
import { percent } from "@/lib/triage/explain";

// One eval item (plan M5): what Jev saw, what it answered in each run, what
// the plain-code baselines answered for the same state, and the gold label.

type Column = {
  name: string;
  type: string;
  area: string;
  duplicate: string | null;
  injection: boolean | null;
  nonGoal: string | null;
};

export function EvalItemView({ detail }: { detail: EvalItemDetail }) {
  const { gold, baselines } = detail;
  const yes = 0.5;
  const topNonGoal = (nonGoals: Record<string, number>) => {
    const [top] = Object.entries(nonGoals).toSorted((a, b) => b[1] - a[1]);
    return top && top[1] >= yes ? top[0] : null;
  };
  const columns: Column[] = [
    ...detail.runs.map((run) => ({
      name: `Jev, ${run.role}`,
      type: run.answers.type.choice,
      area: run.answers.area.choice,
      duplicate: run.answers.duplicate?.issueId ?? null,
      injection: run.answers.injection >= yes,
      nonGoal: topNonGoal(run.answers.nonGoals),
    })),
    {
      name: "keyword rules, current",
      type: baselines.keyword.type,
      area: baselines.keyword.area,
      duplicate: null,
      injection: baselines.keyword.injection,
      nonGoal: baselines.keyword.nonGoal,
    },
    {
      name: "keyword rules v0",
      type: baselines.keywordV0.type,
      area: baselines.keywordV0.area,
      duplicate: null,
      injection: baselines.keywordV0.injection,
      nonGoal: baselines.keywordV0.nonGoal,
    },
    {
      name: "majority class",
      type: baselines.majority.type,
      area: baselines.majority.area,
      duplicate: null,
      injection: false,
      nonGoal: null,
    },
    {
      name: `search top hit${baselines.ftsThreshold === null ? "" : ` (≥ ${baselines.ftsThreshold.toFixed(2)})`}`,
      type: "",
      area: "",
      duplicate: baselines.ftsTop1,
      injection: null,
      nonGoal: null,
    },
  ];
  const goldInjection = gold.signals?.injection ?? null;
  const rows: {
    label: string;
    gold: string;
    cell: (column: Column) => { text: string; right: boolean | null };
  }[] = [
    {
      label: "Type",
      gold: labelOf(TYPE_LABELS, gold.type),
      cell: (c) =>
        c.type
          ? { text: labelOf(TYPE_LABELS, c.type), right: c.type === gold.type }
          : { text: "", right: null },
    },
    {
      label: "Area",
      gold: labelOf(AREA_LABELS, gold.area),
      cell: (c) =>
        c.area
          ? { text: labelOf(AREA_LABELS, c.area), right: c.area === gold.area }
          : { text: "", right: null },
    },
    {
      label: "Duplicate of",
      gold: gold.duplicateOf ?? "none",
      cell: (c) =>
        c.name.startsWith("Jev") || c.name.startsWith("search")
          ? { text: c.duplicate ?? "none", right: c.duplicate === gold.duplicateOf }
          : { text: "", right: null },
    },
    {
      label: "Injection",
      gold: goldInjection === null ? "not labeled" : goldInjection ? "yes" : "no",
      cell: (c) =>
        c.injection === null
          ? { text: "", right: null }
          : {
              text: c.injection ? "yes" : "no",
              right: goldInjection === null ? null : c.injection === goldInjection,
            },
    },
    {
      label: "Non-goal",
      gold: gold.nonGoal ? nonGoalLabel(gold.nonGoal) : "none",
      cell: (c) =>
        c.name.startsWith("search")
          ? { text: "", right: null }
          : {
              text: c.nonGoal ? nonGoalLabel(c.nonGoal) : "none",
              right: c.nonGoal === gold.nonGoal,
            },
    },
  ];
  const [first] = detail.runs;

  return (
    <article className="space-y-8">
      <header className="space-y-2">
        <Link
          href={`/eval?part=${detail.part}#misses`}
          className="text-xs text-muted-foreground hover:underline"
        >
          ← Evaluation, {detail.part}
        </Link>
        <h1 className="font-mono text-xl font-semibold">{detail.itemId}</h1>
        <p className="flex flex-wrap gap-2 text-xs text-muted-foreground">
          <Badge variant="secondary">{detail.set}</Badge>
          <span>tracker {detail.tracker}</span>
          <span>· gold priority {gold.priority}</span>
          {gold.attackTarget && (
            <span>
              · the injection aims at{" "}
              {Object.entries(gold.attackTarget)
                .map(([key, value]) => `${key} ${value}`)
                .join(", ")}
            </span>
          )}
        </p>
      </header>

      <section aria-labelledby="answers" className="space-y-2">
        <h2 id="answers" className="text-base font-semibold">
          Answers next to the gold label
        </h2>
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-xs">
            <thead className="bg-muted/50 text-left text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">
                  <span className="sr-only">Question</span>
                </th>
                <th className="px-3 py-2 font-medium">gold</th>
                {columns.map((column) => (
                  <th key={column.name} className="px-3 py-2 font-medium">
                    {column.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((row) => (
                <tr key={row.label}>
                  <th scope="row" className="px-3 py-2 text-left font-medium">
                    {row.label}
                  </th>
                  <td className="px-3 py-2 font-medium">{row.gold}</td>
                  {columns.map((column) => {
                    const { text, right } = row.cell(column);
                    return (
                      <td
                        key={column.name}
                        className={cn(
                          "px-3 py-2",
                          right === true && "text-emerald-700 dark:text-emerald-400",
                          right === false &&
                            "bg-red-50 text-red-800 dark:bg-red-950 dark:text-red-200",
                        )}
                      >
                        {text}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {first && (
        <section aria-labelledby="probabilities" className="grid gap-8 lg:grid-cols-2">
          <div className="space-y-2">
            <h2 id="probabilities" className="text-base font-semibold">
              Jev's probabilities, {first.role} run
            </h2>
            <ul className="space-y-1 text-xs">
              {choiceRows(first.answers).map(([label, entries, labels]) => (
                <li key={label} className="space-y-1">
                  <p className="font-medium">{label}</p>
                  <ul className="space-y-0.5 pl-2">
                    {entries
                      .toSorted((a, b) => b[1] - a[1])
                      .slice(0, 4)
                      .map(([key, probability]) => (
                        <li key={key} className="grid grid-cols-[9rem_1fr] items-center gap-2">
                          <span className="truncate">{labelOf(labels, key)}</span>
                          <ProbabilityBar probability={probability} />
                        </li>
                      ))}
                  </ul>
                </li>
              ))}
              {(
                [
                  "blocked",
                  "workaround",
                  "regression",
                  "dataExposure",
                  "dataLoss",
                  "injection",
                ] as const
              ).map((key) => (
                <li key={key} className="grid grid-cols-[9rem_1fr] items-center gap-2">
                  <span>{key}</span>
                  <ProbabilityBar probability={first.answers[key]} threshold={yes} />
                </li>
              ))}
            </ul>
          </div>
          <div className="space-y-2">
            <h2 className="text-base font-semibold">Duplicate candidates</h2>
            {first.candidates.length === 0 ? (
              <p className="text-xs text-muted-foreground">No candidates were offered.</p>
            ) : (
              <ul className="space-y-1 text-xs">
                <li className="grid grid-cols-[1fr_auto] items-center gap-2 text-muted-foreground">
                  <span>none of them</span>
                  <span>{percent(first.answers.duplicate?.probabilities.none ?? 0)}</span>
                </li>
                {first.candidates.map((candidate) => (
                  <li
                    key={candidate.issueId}
                    className="grid grid-cols-[1fr_auto] items-center gap-2"
                  >
                    <span
                      className={cn(
                        "truncate",
                        candidate.issueId === gold.duplicateOf && "font-medium",
                      )}
                    >
                      <span className="font-mono">{candidate.issueId}</span> {candidate.title}
                      {candidate.issueId === gold.duplicateOf && " (the original)"}
                    </span>
                    <ProbabilityBar probability={candidate.probability} />
                  </li>
                ))}
              </ul>
            )}
            <p className="text-xs text-muted-foreground">
              Latency of each run: {detail.runs.map((run) => `${run.role} ${run.ms} ms`).join(", ")}
              .
            </p>
          </div>
        </section>
      )}

      <section aria-labelledby="state" className="space-y-2">
        <h2 id="state" className="text-base font-semibold">
          What Jev saw
        </h2>
        <p className="text-xs text-muted-foreground">
          The ticket's state as sent: the subject, the first message and the last three, each cut to
          2,500 characters. Corpus issues have their form headings removed.
        </p>
        <div className="space-y-2 rounded-lg border p-4 text-sm">
          <p className="font-medium">{detail.state.ticket.subject}</p>
          {detail.state.ticket.messages.map((message, index) => (
            // Messages are positions in the state; they never reorder.
            // oxlint-disable-next-line react/no-array-index-key
            <div key={index} className="space-y-1">
              <p className="text-xs text-muted-foreground">{message.from}</p>
              <p className="break-words whitespace-pre-wrap">{message.text}</p>
            </div>
          ))}
        </div>
      </section>
    </article>
  );
}

function choiceRows(answers: EvalItemDetail["runs"][number]["answers"]) {
  const rows: [string, [string, number][], Record<string, string>][] = [
    ["Type", Object.entries(answers.type.probabilities), TYPE_LABELS],
    ["Area", Object.entries(answers.area.probabilities), AREA_LABELS],
  ];
  return rows;
}
