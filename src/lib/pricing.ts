// Jev's price (plan M3). Source: https://docs.typesafe.ai/models, read on
// 2026-10-05: $0.042 per 1M input tokens ($42 per 1B); output tokens are free.

export const JEV_PRICE = {
  inputUsdPerMillionTokens: 0.042,
  outputUsdPerMillionTokens: 0,
  source: "https://docs.typesafe.ai/models",
  retrieved: "2026-10-05",
} as const;

export function jevCostUsd(inputTokens: number, outputTokens = 0): number {
  return (
    (inputTokens * JEV_PRICE.inputUsdPerMillionTokens +
      outputTokens * JEV_PRICE.outputUsdPerMillionTokens) /
    1_000_000
  );
}
