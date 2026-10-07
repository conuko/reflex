import { cn } from "cn";

import type { Rate } from "@/lib/eval/format";
import type { CalibrationBin } from "@/lib/eval/stats";

import { format, interval } from "@/lib/eval/format";

// The evaluation screen's figures (plan M5), drawn from the imported report
// with plain SVG and CSS. Every rate is written exactly as in summary-<part>.md
// (k/n = value, then the 95% interval), so the screen and the file agree.

export function rateText(rate: Rate): string {
  return `${format(rate)} (${interval(rate.ci)})`;
}

export type RateRow = { label: string; rate: Rate; jev?: boolean };

/** Horizontal bars on a 0 to 1 scale, each with its 95% interval as a line. */
export function RateBars({ rows, caption }: { rows: RateRow[]; caption?: string }) {
  return (
    <figure className="space-y-1.5">
      {caption && <figcaption className="text-xs text-muted-foreground">{caption}</figcaption>}
      <ul className="space-y-1.5">
        {rows.map(({ label, rate, jev }) => (
          <li
            key={label}
            className="grid grid-cols-[minmax(0,10rem)_minmax(3rem,1fr)_auto] items-center gap-3 text-xs"
          >
            <span className={cn("truncate", jev ? "font-medium" : "text-muted-foreground")}>
              {label}
            </span>
            <span className="relative h-3 rounded-sm bg-muted" aria-hidden>
              {rate.value !== null && (
                <span
                  className={cn(
                    "absolute inset-y-0 left-0 rounded-sm",
                    jev ? "bg-primary/80" : "bg-foreground/25",
                  )}
                  style={{ width: `${rate.value * 100}%` }}
                />
              )}
              {rate.ci && (
                <span
                  className="absolute top-1/2 h-px -translate-y-1/2 bg-foreground"
                  style={{
                    left: `${rate.ci.low * 100}%`,
                    width: `${Math.max(0.5, (rate.ci.high - rate.ci.low) * 100)}%`,
                  }}
                />
              )}
            </span>
            <span className="whitespace-nowrap tabular-nums">{rateText(rate)}</span>
          </li>
        ))}
      </ul>
    </figure>
  );
}

const asIs = (label: string) => label;

/** Gold labels as rows, answers as columns; shading by the share of the row. */
export function ConfusionMatrix({
  labels,
  matrix,
  title,
  format: name = asIs,
}: {
  labels: readonly string[];
  matrix: readonly (readonly number[])[];
  title: string;
  format?: (label: string) => string;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="border-separate border-spacing-px text-xs tabular-nums">
        <caption className="mb-2 text-left text-muted-foreground">
          {title}: gold label in rows, Jev's answer in columns.
        </caption>
        <thead>
          <tr>
            <th scope="col" className="w-32">
              <span className="sr-only">Gold label</span>
            </th>
            {labels.map((label) => (
              <th
                key={label}
                scope="col"
                className="h-20 w-11 align-bottom font-normal text-muted-foreground"
              >
                <span className="inline-block origin-bottom-left translate-x-3 -rotate-45 whitespace-nowrap">
                  {name(label)}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {labels.map((gold, row) => {
            const counts = matrix[row] ?? [];
            const total = counts.reduce((sum, count) => sum + count, 0);
            return (
              <tr key={gold}>
                <th
                  scope="row"
                  className="truncate pr-2 text-right font-normal text-muted-foreground"
                >
                  {name(gold)}
                </th>
                {labels.map((answer, column) => {
                  const count = counts[column] ?? 0;
                  const share = total === 0 ? 0 : count / total;
                  const right = row === column;
                  return (
                    <td
                      key={answer}
                      title={`${name(gold)} answered as ${name(answer)}: ${count}`}
                      className={cn(
                        "h-8 rounded-sm text-center",
                        count === 0 && "bg-muted/40 text-muted-foreground/40",
                      )}
                      style={
                        count === 0
                          ? undefined
                          : {
                              backgroundColor: right
                                ? `color-mix(in oklch, oklch(0.6 0.15 150) ${20 + share * 60}%, transparent)`
                                : `color-mix(in oklch, oklch(0.6 0.2 25) ${25 + share * 60}%, transparent)`,
                            }
                      }
                    >
                      {count === 0 ? "·" : count}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const PLOT = { size: 220, pad: 28 } as const;

function scale(value: number, from: number) {
  const inner = PLOT.size - 2 * PLOT.pad;
  return PLOT.pad + ((value - from) / (1 - from)) * inner;
}

/** Accuracy against mean probability per bin; on the diagonal, Jev's probabilities mean what they say. */
export function ReliabilityDiagram({ bins }: { bins: readonly CalibrationBin[] }) {
  const from = Math.min(
    0.5,
    ...bins.map(({ confidence, accuracy }) => Math.min(confidence, accuracy)),
  );
  const x = (value: number) => scale(value, from);
  const y = (value: number) => PLOT.size - scale(value, from);
  const ticks = [from, (from + 1) / 2, 1];
  return (
    <>
      <span className="sr-only">
        {`Reliability: ${bins.map((bin) => `mean probability ${bin.confidence.toFixed(2)}, accuracy ${bin.accuracy.toFixed(2)}, n ${bin.n}`).join("; ")}`}
      </span>
      <svg aria-hidden viewBox={`0 0 ${PLOT.size} ${PLOT.size}`} className="w-full max-w-64">
        <line
          x1={x(from)}
          y1={y(from)}
          x2={x(1)}
          y2={y(1)}
          className="stroke-muted-foreground/40"
          strokeDasharray="3 3"
        />
        <line x1={x(from)} y1={y(from)} x2={x(1)} y2={y(from)} className="stroke-border" />
        <line x1={x(from)} y1={y(from)} x2={x(from)} y2={y(1)} className="stroke-border" />
        {ticks.map((tick) => (
          <g key={tick} className="fill-muted-foreground text-[9px]">
            <text x={x(tick)} y={PLOT.size - 8} textAnchor="middle">
              {tick.toFixed(2)}
            </text>
            <text x={6} y={y(tick) + 3}>
              {tick.toFixed(2)}
            </text>
          </g>
        ))}
        <polyline
          points={bins.map((bin) => `${x(bin.confidence)},${y(bin.accuracy)}`).join(" ")}
          className="fill-none stroke-primary"
        />
        {bins.map((bin, index) => (
          <circle
            // Bins are positions; they never reorder.
            // oxlint-disable-next-line react/no-array-index-key
            key={index}
            cx={x(bin.confidence)}
            cy={y(bin.accuracy)}
            r={2 + Math.sqrt(bin.n) / 2}
            className="fill-primary/70"
          />
        ))}
      </svg>
    </>
  );
}

/** Type accuracy of the tickets kept, against the share sent to review, one point per threshold. */
export function ReviewCurve({
  points,
}: {
  points: readonly { threshold: number; sentToReview: Rate; accuracyOfRest: Rate }[];
}) {
  const width = 260;
  const height = 160;
  const pad = 30;
  const maxShare = Math.max(0.1, ...points.map(({ sentToReview }) => sentToReview.value ?? 0));
  const lowest = Math.min(0.8, ...points.map(({ accuracyOfRest }) => accuracyOfRest.value ?? 1));
  const x = (share: number) => pad + (share / maxShare) * (width - 2 * pad);
  const y = (accuracy: number) =>
    height - pad - ((accuracy - lowest) / (1 - lowest)) * (height - 2 * pad);
  return (
    <svg aria-hidden viewBox={`0 0 ${width} ${height}`} className="w-full max-w-80">
      <line
        x1={pad}
        y1={height - pad}
        x2={width - pad}
        y2={height - pad}
        className="stroke-border"
      />
      <line x1={pad} y1={pad} x2={pad} y2={height - pad} className="stroke-border" />
      <text
        x={width / 2}
        y={height - 6}
        textAnchor="middle"
        className="fill-muted-foreground text-[9px]"
      >
        sent to review (0 to {Math.round(maxShare * 100)}%)
      </text>
      <text x={8} y={pad - 10} className="fill-muted-foreground text-[9px]">
        accuracy of the rest ({lowest.toFixed(2)} to 1)
      </text>
      <polyline
        points={points
          .map(
            (point) => `${x(point.sentToReview.value ?? 0)},${y(point.accuracyOfRest.value ?? 0)}`,
          )
          .join(" ")}
        className="fill-none stroke-primary"
      />
      {points.map((point) => (
        <g key={point.threshold}>
          <circle
            cx={x(point.sentToReview.value ?? 0)}
            cy={y(point.accuracyOfRest.value ?? 0)}
            r={3}
            className="fill-primary"
          />
          <text
            x={x(point.sentToReview.value ?? 0)}
            y={y(point.accuracyOfRest.value ?? 0) - 6}
            textAnchor="middle"
            className="fill-foreground text-[8px]"
          >
            {point.threshold.toFixed(2)}
          </text>
        </g>
      ))}
    </svg>
  );
}

const LATENCY_BIN_MS = 25;

/** Requests per 25 ms, with the report's p50 and p95 marked. */
export function LatencyHistogram({
  ms,
  p50,
  p95,
}: {
  ms: readonly number[];
  p50: number;
  p95: number;
}) {
  if (ms.length === 0) return null;
  const first = Math.floor((ms[0] ?? 0) / LATENCY_BIN_MS);
  const last = Math.floor((ms.at(-1) ?? 0) / LATENCY_BIN_MS);
  const counts = Array.from({ length: last - first + 1 }, () => 0);
  for (const value of ms) {
    const index = Math.floor(value / LATENCY_BIN_MS) - first;
    counts[index] = (counts[index] ?? 0) + 1;
  }
  const width = 320;
  const height = 120;
  const pad = 20;
  const barWidth = (width - 2 * pad) / counts.length;
  const top = Math.max(...counts);
  const x = (value: number) =>
    pad + ((value / LATENCY_BIN_MS - first) / counts.length) * (width - 2 * pad);
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full max-w-96" aria-hidden>
      {counts.map((count, index) => {
        const barHeight = (count / top) * (height - 2 * pad);
        return (
          <rect
            // Bins are positions; they never reorder.
            // oxlint-disable-next-line react/no-array-index-key
            key={index}
            x={pad + index * barWidth + 1}
            y={height - pad - barHeight}
            width={Math.max(1, barWidth - 2)}
            height={barHeight}
            className="fill-foreground/30"
          />
        );
      })}
      {[
        { name: "p50", value: p50 },
        { name: "p95", value: p95 },
      ].map(({ name, value }) => (
        <g key={name}>
          <line
            x1={x(value)}
            x2={x(value)}
            y1={pad - 6}
            y2={height - pad}
            className="stroke-primary"
            strokeDasharray="2 2"
          />
          <text x={x(value)} y={pad - 8} textAnchor="middle" className="fill-foreground text-[9px]">
            {name} {Math.round(value)} ms
          </text>
        </g>
      ))}
      <text x={pad} y={height - 6} className="fill-muted-foreground text-[9px]">
        {first * LATENCY_BIN_MS} ms
      </text>
      <text
        x={width - pad}
        y={height - 6}
        textAnchor="end"
        className="fill-muted-foreground text-[9px]"
      >
        {(last + 1) * LATENCY_BIN_MS} ms
      </text>
    </svg>
  );
}
