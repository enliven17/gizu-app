export const estimatePeriods = { "1M": 1 / 12, "6M": 0.5, "1Y": 1 } as const;
export type EstimatePeriod = keyof typeof estimatePeriods;

/** Largest amount the calculator accepts; keeps float math well inside safe precision. */
export const MAX_ESTIMATE_AMOUNT = 1_000_000_000;

/** Parses a user-typed USD amount ("1,250.50" → 1250.5); null when empty or invalid. */
export function parseEstimateAmount(input: string): number | null {
  const clean = input.replace(/,/g, "").trim();
  if (!/^\d+(\.\d{0,2})?$/.test(clean)) return null;
  const value = Number(clean);
  return value > 0 && value <= MAX_ESTIMATE_AMOUNT ? value : null;
}

/**
 * Illustrative projection only, not a quote: APY already compounds, APR is simple interest.
 * ponytail: float math is fine for a display estimate; never feed this into a transaction.
 */
export function estimateEarnings(
  amount: number,
  ratePercent: number,
  rateType: "apy" | "apr",
  period: EstimatePeriod,
): { earned: number; total: number } {
  const years = estimatePeriods[period];
  const rate = ratePercent / 100;
  const total = rateType === "apy" ? amount * (1 + rate) ** years : amount * (1 + rate * years);
  return { earned: total - amount, total };
}
