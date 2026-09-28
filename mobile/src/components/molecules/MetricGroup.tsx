import { View } from "react-native";
import { FadeIn } from "./FadeIn";
import { Metric } from "./Metric";

type MetricItem = { label: string; value: string; accent?: boolean };

/** Frontend stat tiles enter 60ms apart. */
const TILE_STAGGER = 60;

export function MetricGroup({
  metrics,
  columns = 2,
  enterDelay = 0,
}: {
  metrics: MetricItem[];
  /** 3 = frontend vault-detail row of equal stat tiles. */
  columns?: 2 | 3;
  /** Milliseconds before the first tile enters (3-column tiles only). */
  enterDelay?: number;
}) {
  if (columns === 3) {
    return (
      <View className="flex-row gap-2">
        {metrics.map((metric, index) => (
          <FadeIn
            key={metric.label}
            delay={enterDelay + index * TILE_STAGGER}
            className="min-w-0 flex-1"
          >
            <Metric tile {...metric} />
          </FadeIn>
        ))}
      </View>
    );
  }
  return (
    <View className="flex-row flex-wrap justify-between gap-y-3">
      {metrics.map((metric) => (
        <View key={metric.label} className="w-full xs:w-[48%]">
          <Metric label={metric.label} value={metric.value} />
        </View>
      ))}
    </View>
  );
}
