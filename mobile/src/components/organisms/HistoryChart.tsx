import { useMemo, useState } from "react";
import { View } from "react-native";
import { LineChart } from "@/components/molecules/chart/LineChart";
import { PeriodPills } from "@/components/molecules/chart/PeriodPills";
import { periods, periodSeries, type Period } from "@/domain/investments";

const flat = [0, 0];

export function HistoryChart({
  series,
  height = 150,
  up,
}: {
  series: number[];
  /** Plot height in points (frontend: 140 on Home, 190 on vault detail). */
  height?: number;
  /** Line colour direction; defaults to the selected period's own trend. */
  up?: boolean;
}) {
  const [period, setPeriod] = useState<Period>("1M");
  const values = useMemo(() => periodSeries(series, period), [series, period]);
  const first = values[0];
  const last = values[values.length - 1];
  const hasHistory = values.length > 1 && first !== undefined && last !== undefined;
  // No history: a flat line at zero instead of an empty-state message.
  const plotted = hasHistory ? values : flat;
  const summary = hasHistory
    ? `${period} index: Start ${first.toFixed(2)} · End ${last.toFixed(2)} (${values.length} samples)`
    : `${period} index: no history`;
  return (
    <View className="gap-3">
      <View
        className="pt-3"
        accessible
        accessibilityLabel={summary}
        accessibilityLiveRegion="polite"
      >
        <LineChart
          series={plotted}
          height={height}
          up={up ?? (hasHistory ? last >= first : true)}
          revealKey={period}
        />
      </View>
      <PeriodPills options={periods} selected={period} onSelect={setPeriod} />
    </View>
  );
}
