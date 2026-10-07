import type { ReactNode } from "react";

import { cn } from "cn";
import Link from "next/link";

import type { ChoiceSection } from "@/lib/eval/report";
import type { EvalOverview } from "@/lib/reads/eval";

import {
  ConfusionMatrix,
  LatencyHistogram,
  RateBars,
  rateText,
  ReliabilityDiagram,
  ReviewCurve,
} from "@/components/eval/charts";
import { formatDateTime } from "@/components/format";
import { Badge } from "@/components/ui/badge";
import { interval } from "@/lib/eval/format";
import { GATE_CHECKS, GATE_VERSION } from "@/lib/eval/gate";
import { AREA_LABELS, labelOf, TYPE_LABELS } from "@/lib/labels";
import { JEV_PRICE } from "@/lib/pricing";

// The evaluation screen (plan M5): the committed eval of one part, Jev next
// to the reference baselines in plain code (ADR-0003). Every figure comes
// from the imported report and is written as in summary-<part>.md.

const SET_LABELS: Record<string, string> = {
  corpus: "issue corpus",
  support: "support tickets",
  adversarial: "adversarial",
};

export function EvalView({ overview }: { overview: EvalOverview }) {
  const { report, part } = overview;
  return (
    <div className="space-y-10">
      <Runs overview={overview} />
      <Section
        id="gate"
        title={`Gate (${GATE_VERSION})${part === "test" ? "" : ": preview on dev"}`}
      >
        <Gate overview={overview} />
      </Section>
      <Section
        id="type"
        title="Type"
        note="One ticket type per ticket: bug, feature request, question, account or billing, other."
      >
        <Choice section={report.type} name="type" />
      </Section>
      <Section id="area" title="Area" note="The product area, which picks the squad.">
        <Choice section={report.area} name="area" />
      </Section>
      <Section
        id="duplicates"
        title="Duplicates"
        note="Search offers up to 10 existing issues of the ticket's tracker; Jev picks one or none."
      >
        <RateBars
          rows={[
            { label: "Jev: hit rate, all duplicates", rate: report.duplicates.hitRate, jev: true },
            {
              label: "Jev: pick, original offered",
              rate: report.duplicates.pickAccuracy,
              jev: true,
            },
            {
              label: `Search top hit (rank ≥ ${report.duplicates.search.threshold?.toFixed(2) ?? "n/a"})`,
              rate: report.duplicates.search.hitRate,
            },
            ...report.duplicates.recall.map(({ k, rate }) => ({
              label: `Search recall@${k} (ceiling)`,
              rate,
            })),
          ]}
          caption="Share of duplicate tickets linked to their original."
        />
        <RateBars
          rows={[
            { label: "Jev", rate: report.duplicates.falseMatchRate, jev: true },
            { label: "Search top hit", rate: report.duplicates.search.falseMatchRate },
          ]}
          caption={`False matches: share of tickets that duplicate nothing but got linked. "Always none" links nothing: 0/${report.duplicates.positives} hits, no false matches.`}
        />
        {report.duplicates.shuffleStability && (
          <p className="text-xs text-muted-foreground">
            Same pick with the candidates in shuffled order:{" "}
            {rateText(report.duplicates.shuffleStability)}.
          </p>
        )}
      </Section>
      <Section id="injection" title="Injection and non-goals">
        <div className="grid gap-6 xl:grid-cols-2">
          <RateBars
            caption={`Injections recognized (recall). "Always no" scores 0/${report.injection.recall.n}.`}
            rows={[
              { label: "Jev", rate: report.injection.recall, jev: true },
              { label: "keyword rules", rate: report.injection.keyword.recall },
            ]}
          />
          <RateBars
            caption="Benign tickets flagged (false positives)"
            rows={[
              { label: "Jev", rate: report.injection.falsePositiveRate, jev: true },
              { label: "keyword rules", rate: report.injection.keyword.falsePositiveRate },
            ]}
          />
          <RateBars
            caption={`Asked-for non-goal recognized. "Always no" scores 0/${report.nonGoals.correct.n}.`}
            rows={[
              { label: "Jev", rate: report.nonGoals.correct, jev: true },
              { label: "keyword rules", rate: report.nonGoals.keyword.correct },
            ]}
          />
          <RateBars
            caption="Non-goal flagged on other tickets"
            rows={[
              { label: "Jev", rate: report.nonGoals.falsePositives, jev: true },
              { label: "keyword rules", rate: report.nonGoals.keyword.falsePositives },
            ]}
          />
        </div>
        <p className="text-xs text-muted-foreground">
          Attack success, injections whose triage ended where the attacker wanted:{" "}
          {rateText(report.injection.attackSuccess)}.
        </p>
      </Section>
      <Section
        id="priority"
        title="Priority (directional)"
        note="The policy over Jev's answers, with a Business workspace, no spike and no demand. Urgent and High count as high, Medium as medium, Low and Won't do as low."
      >
        <RateBars
          rows={[
            { label: "Jev + policy, exact", rate: report.priority.exact, jev: true },
            { label: "Jev + policy, within one", rate: report.priority.withinOne, jev: true },
            { label: "Jev + policy, bugs only", rate: report.priority.bugsExact, jev: true },
            {
              label: `majority class (${report.priority.majorityExact.label})`,
              rate: report.priority.majorityExact,
            },
            {
              label: "policy over gold answers",
              rate: report.priority.goldAnswersExact,
            },
          ]}
        />
        <p className="text-xs text-muted-foreground">
          Weighted kappa (linear): {number(report.priority.weightedKappa)}. "Policy over gold
          answers" is what perfect answers would score on the hand-written sets: the gap to it is
          the model's, the rest is the policy's.
        </p>
        <ConfusionMatrix
          title="Priority"
          labels={["high", "medium", "low"]}
          matrix={report.priority.matrix}
        />
      </Section>
      <Section id="consistency" title="Consistency">
        <RateBars
          rows={[
            ...(report.consistency.secondRun
              ? [
                  { label: "same type, second run", rate: report.consistency.secondRun.type },
                  { label: "same area, second run", rate: report.consistency.secondRun.area },
                  {
                    label: "same duplicate, second run",
                    rate: report.consistency.secondRun.duplicate,
                  },
                ]
              : []),
            ...(report.consistency.shuffleFlips
              ? [
                  {
                    label: "type changes, shuffled options",
                    rate: report.consistency.shuffleFlips.type,
                  },
                  {
                    label: "area changes, shuffled options",
                    rate: report.consistency.shuffleFlips.area,
                  },
                ]
              : []),
          ]}
        />
        {!report.consistency.secondRun && (
          <p className="text-xs text-muted-foreground">No second run on this part.</p>
        )}
      </Section>
      <Section
        id="calibration"
        title="Calibration"
        note={`Type and area answers pooled (n = ${report.calibration.choice.n}), using the probability of the chosen option: ECE ${number(report.calibration.choice.ece)} over 5 equal-mass bins, Brier ${number(report.calibration.choice.brier)}.`}
      >
        <div className="grid gap-8 xl:grid-cols-2">
          <figure className="space-y-2">
            <figcaption className="text-xs text-muted-foreground">
              Accuracy against Jev's probability, per bin; dashed: perfect calibration.
            </figcaption>
            <ReliabilityDiagram bins={overview.reliability} />
            <table className="text-xs tabular-nums">
              <thead className="text-muted-foreground">
                <tr>
                  <th className="pr-4 text-left font-normal">bin</th>
                  <th className="pr-4 text-right font-normal">n</th>
                  <th className="pr-4 text-right font-normal">mean probability</th>
                  <th className="text-right font-normal">accuracy</th>
                </tr>
              </thead>
              <tbody>
                {overview.reliability.map((bin, index) => (
                  // Bins are positions; they never reorder.
                  // oxlint-disable-next-line react/no-array-index-key
                  <tr key={index}>
                    <td className="pr-4">{index + 1}</td>
                    <td className="pr-4 text-right">{bin.n}</td>
                    <td className="pr-4 text-right">{bin.confidence.toFixed(3)}</td>
                    <td className="text-right">{bin.accuracy.toFixed(3)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </figure>
          <figure className="space-y-2">
            <figcaption className="text-xs text-muted-foreground">
              Accuracy vs. share sent to review, by the type probability below which a ticket goes
              to review.
            </figcaption>
            <ReviewCurve points={report.calibration.reviewCurve} />
            <table className="text-xs tabular-nums">
              <thead className="text-muted-foreground">
                <tr>
                  <th className="pr-4 text-left font-normal">review below</th>
                  <th className="pr-4 text-left font-normal">sent to review</th>
                  <th className="text-left font-normal">type accuracy of the rest</th>
                </tr>
              </thead>
              <tbody>
                {report.calibration.reviewCurve.map((point) => (
                  <tr key={point.threshold}>
                    <td className="pr-4">{point.threshold.toFixed(2)}</td>
                    <td className="pr-4">{rateText(point.sentToReview)}</td>
                    <td>{rateText(point.accuracyOfRest)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </figure>
        </div>
        <RateBars
          caption="Yes/no answers, accuracy at 0.5 on the hand-written sets"
          rows={report.calibration.signals.map(({ name, accuracy }) => ({
            label: name,
            rate: accuracy,
            jev: true,
          }))}
        />
      </Section>
      <Section id="latency" title="Latency and cost">
        <div className="grid gap-8 xl:grid-cols-2">
          <figure className="space-y-2">
            <figcaption className="text-xs text-muted-foreground">
              {report.latency.n} requests
              {report.latency.sequential ? ", sent one at a time" : ", sent four at a time"}: p50{" "}
              {Math.round(report.latency.p50)} ms, p95 {Math.round(report.latency.p95)} ms.
            </figcaption>
            <LatencyHistogram
              ms={overview.latency.ms}
              p50={report.latency.p50}
              p95={report.latency.p95}
            />
          </figure>
          <table className="h-fit text-sm">
            <tbody className="divide-y">
              <tr>
                <th className="py-1.5 pr-6 text-left font-normal text-muted-foreground">
                  Requests per ticket
                </th>
                <td className="tabular-nums">1</td>
              </tr>
              <tr>
                <th className="py-1.5 pr-6 text-left font-normal text-muted-foreground">
                  Mean input tokens per ticket
                </th>
                <td className="tabular-nums">
                  {Math.round(report.cost.meanInputTokens).toLocaleString("en-US")}
                </td>
              </tr>
              <tr>
                <th className="py-1.5 pr-6 text-left font-normal text-muted-foreground">
                  Price per 1M input tokens
                </th>
                <td className="tabular-nums">
                  ${JEV_PRICE.inputUsdPerMillionTokens} (output is free)
                </td>
              </tr>
              <tr>
                <th className="py-1.5 pr-6 text-left font-normal text-muted-foreground">
                  Cost per 1,000 tickets
                </th>
                <td className="font-medium tabular-nums">
                  ${report.cost.usdPer1000Tickets.toFixed(3)}
                </td>
              </tr>
              <tr>
                <th className="py-1.5 pr-6 text-left font-normal text-muted-foreground">
                  Price source
                </th>
                <td className="text-xs">
                  {JEV_PRICE.source}, read {JEV_PRICE.retrieved}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </Section>
      <Section
        id="misses"
        title="What Jev got wrong"
        note="Items of the first run whose type, area or duplicate pick differs from the gold label. Open one to see what Jev saw and answered, next to the baselines."
      >
        <Misses overview={overview} />
      </Section>
    </div>
  );
}

function Section({
  id,
  title,
  note,
  children,
}: {
  id: string;
  title: string;
  note?: string;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="space-y-4">
      <div className="space-y-1">
        <h2 id={id} className="text-base font-semibold">
          {title}
        </h2>
        {note && <p className="max-w-3xl text-xs text-muted-foreground">{note}</p>}
      </div>
      {children}
    </section>
  );
}

function Runs({ overview }: { overview: EvalOverview }) {
  const { report } = overview;
  return (
    <section aria-labelledby="runs" className="space-y-2">
      <h2 id="runs" className="text-base font-semibold">
        Runs
      </h2>
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">run</th>
              <th className="px-3 py-2 font-medium">condition</th>
              <th className="px-3 py-2 font-medium">model</th>
              <th className="px-3 py-2 font-medium">question set</th>
              <th className="px-3 py-2 text-right font-medium">items</th>
              <th className="px-3 py-2 font-medium">started</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {overview.runs.map((run) => (
              <tr key={run.id}>
                <td className="px-3 py-2">{run.role}</td>
                <td className="px-3 py-2">{run.condition}</td>
                <td className="px-3 py-2 font-mono text-xs">{run.model}</td>
                <td className="px-3 py-2 font-mono text-xs">
                  {run.questionSetVersion} ({run.questionSetHash})
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{run.itemCount}</td>
                <td className="px-3 py-2 text-xs" suppressHydrationWarning>
                  {formatDateTime(run.startedAt)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">
        Split {report.splitVersion}, candidates {report.candidatesVersion}, keyword rules{" "}
        {report.keywordRulesVersion}. Items:{" "}
        {Object.entries(report.counts)
          .map(([set, n]) => `${SET_LABELS[set] ?? set} ${n}`)
          .join(", ")}
        .{report.testRuns === null ? "" : ` Test runs so far: ${report.testRuns}.`} Imported{" "}
        <span suppressHydrationWarning>{formatDateTime(overview.importedAt)}</span> by{" "}
        <code>pnpm eval:import</code>.
      </p>
    </section>
  );
}

function Gate({ overview }: { overview: EvalOverview }) {
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
          <tr>
            <th className="px-3 py-2 font-medium">check</th>
            <th className="px-3 py-2 font-medium">result</th>
            <th className="px-3 py-2 font-medium">value</th>
            <th className="px-3 py-2 font-medium">if it fails</th>
          </tr>
        </thead>
        <tbody className="divide-y align-top">
          {overview.report.gate.map(({ id, pass, value }) => {
            const check = GATE_CHECKS.find((candidate) => candidate.id === id);
            return (
              <tr key={id}>
                <td className="px-3 py-2">
                  {check?.criterion ?? id}
                  {check?.directional && (
                    <span className="text-xs text-muted-foreground"> (directional)</span>
                  )}
                </td>
                <td className="px-3 py-2">
                  <Badge variant={pass ? "secondary" : "destructive"}>
                    {pass ? "pass" : "fail"}
                  </Badge>
                </td>
                <td className="px-3 py-2 text-xs tabular-nums">{value}</td>
                <td className={cn("px-3 py-2 text-xs", !pass && "font-medium")}>
                  {check?.fallback}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Choice({ section, name }: { section: ChoiceSection; name: "type" | "area" }) {
  const labels: Record<string, string> = name === "type" ? TYPE_LABELS : AREA_LABELS;
  return (
    <div className="space-y-4">
      <RateBars
        rows={[
          { label: "Jev", rate: section.jev, jev: true },
          ...Object.entries(section.bySet).map(([set, rate]) => ({
            label: `Jev, ${SET_LABELS[set] ?? set}`,
            rate,
            jev: true,
          })),
          {
            label: `majority class (${labelOf(labels, section.majority.label)})`,
            rate: section.majority,
          },
          { label: "keyword rules v0", rate: section.keywordV0 },
          { label: "keyword rules, current", rate: section.keyword },
        ]}
        caption="Accuracy with its 95% interval."
      />
      <p className="text-xs text-muted-foreground">
        Jev − keyword rules: {number(section.difference.value)} ({interval(section.difference.ci)}).
        Exact McNemar: Jev alone right on {section.mcnemar.jevOnly}, the rules alone on{" "}
        {section.mcnemar.keywordOnly}, p = {section.mcnemar.p.toPrecision(2)}. The keyword rules
        matched at all on {rateText(section.keyword.coverage)}.
      </p>
      <ConfusionMatrix
        title={name === "type" ? "Type" : "Area"}
        labels={section.confusion.labels}
        matrix={section.confusion.matrix}
        format={(label) => labels[label] ?? label}
      />
    </div>
  );
}

function Misses({ overview }: { overview: EvalOverview }) {
  if (overview.misses.length === 0) {
    return <p className="text-sm text-muted-foreground">None.</p>;
  }
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
          <tr>
            <th className="px-3 py-2 font-medium">item</th>
            <th className="px-3 py-2 font-medium">set</th>
            <th className="px-3 py-2 font-medium">wrong</th>
            <th className="px-3 py-2 font-medium">gold</th>
            <th className="px-3 py-2 font-medium">Jev</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {overview.misses.map((miss) => (
            <tr key={miss.itemId}>
              <td className="px-3 py-2 font-mono text-xs">
                <Link
                  href={`/eval/${overview.part}/${encodeURIComponent(miss.itemId)}`}
                  className="underline-offset-2 hover:underline"
                >
                  {miss.itemId}
                </Link>
              </td>
              <td className="px-3 py-2 text-xs">{SET_LABELS[miss.set] ?? miss.set}</td>
              <td className="px-3 py-2 text-xs">{miss.wrong.join(", ")}</td>
              <td className="px-3 py-2 text-xs">
                {describe(miss.gold.type, miss.gold.area, miss.gold.duplicateOf, miss.wrong)}
              </td>
              <td className="px-3 py-2 text-xs">
                {describe(miss.jev.type, miss.jev.area, miss.jev.duplicate, miss.wrong)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function describe(
  type: string,
  area: string,
  duplicate: string | null,
  wrong: readonly string[],
): string {
  return [
    wrong.includes("type") ? labelOf(TYPE_LABELS, type) : null,
    wrong.includes("area") ? labelOf(AREA_LABELS, area) : null,
    wrong.includes("duplicate") ? `duplicate of ${duplicate ?? "none"}` : null,
  ]
    .filter(Boolean)
    .join("; ");
}

function number(value: number | null): string {
  return value === null ? "n/a" : value.toFixed(2);
}
