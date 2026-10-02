const oneDecimal = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });
const units: [number, string][] = [
  [1e12, "T"],
  [1e9, "B"],
  [1e6, "M"],
  [1e3, "K"],
];

/**
 * Frontend `money()`: compact USD with one fraction digit ($52.1M).
 * Hand-rolled because Hermes on Android ignores `notation: "compact"`.
 */
export const money = {
  format(value: number | null): string {
    if (value === null) return "Unavailable";
    const sign = value < 0 ? "-" : "";
    const abs = Math.abs(value);
    for (const [size, suffix] of units) {
      // Round first so 999,950 reads $1M, not $1000K.
      if (Math.round((abs / size) * 10) / 10 >= 1) {
        const scaled = Math.round((abs / size) * 10) / 10;
        if (scaled < 1000 || suffix === "T") return `${sign}$${oneDecimal.format(scaled)}${suffix}`;
      }
    }
    return `${sign}$${oneDecimal.format(abs)}`;
  },
};

/** Frontend `percent()` digits: up to two fraction digits. */
export const percent = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });
export function rate(value: number | null): string {
  return value === null ? "Unavailable" : `${percent.format(value)}%`;
}

/** Frontend `unixDate()`: e.g. `Sep 28, 2026`. */
export function unixDate(seconds: number): string {
  return new Date(seconds * 1000).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}
