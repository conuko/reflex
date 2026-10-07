import type { Interval } from "./stats";

// How every rate is written, in summary-<part>.md and on the evaluation
// screen alike: k/n = value, and the 95% interval. No file access, so the web
// app can import it.

export type Rate = { k: number; n: number; value: number | null; ci: Interval | null };

export function format({ k, n, value }: Rate): string {
  return value === null ? "n/a" : `${k}/${n} = ${value.toFixed(2)}`;
}

export function interval(ci: Interval | null): string {
  return ci === null ? "no interval" : `${ci.low.toFixed(2)}–${ci.high.toFixed(2)}`;
}
