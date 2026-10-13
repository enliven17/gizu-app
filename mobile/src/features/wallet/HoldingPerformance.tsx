import { View } from "react-native";
import { Typography } from "@/components/atoms/Typography";
import { LineChart } from "@/components/molecules/chart/LineChart";
import { demoHoldingPerformance } from "@/services/demo/holdingPerformance";

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});
const percent = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });
const formatValue = (value: number) => money.format(value);

/** Mounted only when this card's Performance control is open. */
export function HoldingPerformance({
  assetId,
  valueUsdcAtoms,
  position,
  name,
  height = 100,
}: {
  assetId: string;
  valueUsdcAtoms: string | null;
  position: boolean;
  name: string;
  height?: number;
}) {
  const history = demoHoldingPerformance(assetId, valueUsdcAtoms, position);
  if (!history) {
    return <Typography variant="micro">Performance history isn’t available yet.</Typography>;
  }
  const up = history.percent >= 0;
  const change = `${up ? "+" : ""}${percent.format(history.percent)}%`;
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
