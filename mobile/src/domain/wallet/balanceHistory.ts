/** Total USDC balance observed on this device at a point in time. */
export type BalancePoint = { at: number; atoms: string };
export const balancePeriods = { "1W": 7, "1M": 30, All: Infinity } as const;
export type BalancePeriod = keyof typeof balancePeriods;

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const ATOMS = /^(0|[1-9]\d*)$/;
/** Bounded so storage stays small; a year of daily checks fits. */
export const HISTORY_LIMIT = 400;

/**
 * Records a new observation. Equal readings within six hours and any reading within
 * the same hour collapse into one point so frequent refreshes don't flood history.
 */
export function appendBalancePoint(history: BalancePoint[], point: BalancePoint): BalancePoint[] {
  if (!ATOMS.test(point.atoms) || !Number.isFinite(point.at)) return history;
  const last = history[history.length - 1];
  if (last && point.at <= last.at) return history;
  if (last && last.atoms === point.atoms && point.at - last.at < 6 * HOUR) return history;
  const base = last && point.at - last.at < HOUR ? history.slice(0, -1) : history;
  return [...base, point].slice(-HISTORY_LIMIT);
}

/** USDC values (6 decimals) inside the selected period, oldest first. */
export function balanceSeries(history: BalancePoint[], period: BalancePeriod, now: number) {
  const since = now - balancePeriods[period] * DAY;
  return history.filter((point) => point.at >= since).map((point) => Number(point.atoms) / 1e6);
}

/** Change from the first to the last value; null without two points. */
export function balanceChange(series: number[]) {
  const first = series[0];
  const last = series[series.length - 1];
  if (series.length < 2 || first === undefined || last === undefined) return null;
  return { delta: last - first, percent: first === 0 ? null : ((last - first) / first) * 100 };
}

export function parseBalanceHistory(value: unknown): BalancePoint[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (point): point is BalancePoint =>
        typeof point === "object" &&
        point !== null &&
        typeof point.at === "number" &&
        typeof point.atoms === "string" &&
        ATOMS.test(point.atoms),
    )
    .slice(-HISTORY_LIMIT);
}
