import { View } from "react-native";
import { Metric } from "./Metric";
export function MetricGroup({ metrics }: { metrics: { label: string; value: string }[] }) {
  return (
    <View className="flex-row flex-wrap justify-between gap-y-3">
      {metrics.map((metric) => (
        <View key={metric.label} className="w-full xs:w-[48%]">
          <Metric {...metric} />
        </View>
      ))}
    </View>
  );
}
