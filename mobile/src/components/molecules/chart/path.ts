export type ChartPoint = { x: number; y: number; v: number };

/**
 * Map a series onto a width × height box, highest value at the top.
 * Frontend: `y = height - ((v - min) / span) * (height - 2·pad) - pad`.
 */
export function plotSeries(series: number[], width: number, height: number, pad: number) {
  const min = Math.min(...series);
  const max = Math.max(...series);
  const span = max - min || 1;
  const last = Math.max(1, series.length - 1);
  const points: ChartPoint[] = series.map((v, i) => ({
    x: (i / last) * width,
    y: height - ((v - min) / span) * (height - pad * 2) - pad,
    v,
  }));
  return { points, min, max };
}

const fmt = (n: number) => n.toFixed(2);

/** Catmull-Rom to cubic bezier in one pass (frontend `smooth`). */
export function smoothPath(points: ChartPoint[]): string {
  return points.reduce((d, p, i) => {
    if (i === 0) return `M${fmt(p.x)},${fmt(p.y)}`;
    const p0 = points[i - 2] ?? points[i - 1]!;
    const p1 = points[i - 1]!;
    const p3 = points[i + 1] ?? p;
    const c1x = p1.x + (p.x - p0.x) / 6;
    const c1y = p1.y + (p.y - p0.y) / 6;
    const c2x = p.x - (p3.x - p1.x) / 6;
    const c2y = p.y - (p3.y - p1.y) / 6;
    return `${d} C${fmt(c1x)},${fmt(c1y)} ${fmt(c2x)},${fmt(c2y)} ${fmt(p.x)},${fmt(p.y)}`;
  }, "");
}

/** Close a line path down to the baseline for the gradient fill. */
export function areaPath(line: string, width: number, height: number): string {
  return `${line} L${width},${height} L0,${height} Z`;
}

/** Nearest sample index for a horizontal position inside the chart. */
export function nearestIndex(x: number, width: number, count: number): number {
  if (count < 2 || width <= 0) return Math.max(0, count - 1);
  const ratio = Math.min(1, Math.max(0, x / width));
  return Math.round(ratio * (count - 1));
}
