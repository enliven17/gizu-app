import { View } from "react-native";
import { LineChart } from "@/components/molecules/chart/LineChart";
import type { TvlLoad } from "../useTvlSeries";
import { money } from "../format";

/** No or unavailable history: a flat line at zero instead of an empty-state message. */
const flat = [0, 0];
const formatTvl = (value: number) => money.format(value);

function summary(history: TvlLoad): string {
  if (history.kind === "loading") return "TVL history loading";
  if (history.kind === "failed") return "TVL history unavailable";
  const { series } = history;
  const first = series[0];
  const last = series[series.length - 1];
  if (series.length < 2 || first === undefined || last === undefined) return "No TVL history yet";
  return `TVL history: Start ${money.format(first)} · End ${money.format(last)} (${series.length} samples)`;
}

/** Frontend detail Chart (190 px) over the vault's TVL records. */
export function TvlChart({ history }: { history: TvlLoad }) {
  const series = history.kind === "ready" && history.series.length >= 2 ? history.series : flat;
  const up = (series[series.length - 1] ?? 0) >= (series[series.length - 2] ?? 0);
  return (
    <View
      className="pt-3"
      accessible
      accessibilityLabel={summary(history)}
      accessibilityLiveRegion="polite"
    >
      <LineChart series={series} height={190} up={up} revealKey={history.kind} format={formatTvl} />
    </View>
  );
}
