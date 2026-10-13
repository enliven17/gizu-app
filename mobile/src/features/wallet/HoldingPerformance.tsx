import { View } from "react-native";
import { Typography } from "@/components/atoms/Typography";
import { LineChart } from "@/components/molecules/chart/LineChart";
import type { demoHoldingPerformance } from "@/services/demo/holdingPerformance";

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});
const percent = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });
const formatValue = (value: number) => money.format(value);
export const formatHoldingChange = (value: number) =>
  `${value >= 0 ? "+" : ""}${percent.format(value)}%`;

export function HoldingChange({ name, percent }: { name: string; percent: number }) {
  const change = formatHoldingChange(percent);
  return (
    <Typography
      variant="label"
      accessibilityLabel={`${name} change: ${change} over the past month`}
      className={percent >= 0 ? "!text-[11px]" : "!text-[11px] !text-rose"}
    >
      {change} · 1M
    </Typography>
  );
}

/** Mounted only while the holding card is expanded. */
export function HoldingPerformance({
  assetId,
  history,
  name,
  height = 100,
}: {
  assetId: string;
  history: ReturnType<typeof demoHoldingPerformance>;
  name: string;
  height?: number;
}) {
  if (!history) {
    return <Typography variant="micro">Performance history isn’t available yet.</Typography>;
  }
  const up = history.percent >= 0;
  const change = formatHoldingChange(history.percent);
  return (
    <View className="gap-3">
      <View className="flex-row flex-wrap items-center justify-between gap-1">
        <Typography variant="micro">Past month</Typography>
        <Typography variant="label" className={up ? "" : "!text-rose"}>
          {change}
        </Typography>
      </View>
      <View
        accessible
        accessibilityLabel={`${name} performance chart: ${change} over the past month`}
      >
        <LineChart
          series={history.series}
          height={height}
          up={up}
          revealKey={assetId}
          format={formatValue}
        />
      </View>
    </View>
  );
}
