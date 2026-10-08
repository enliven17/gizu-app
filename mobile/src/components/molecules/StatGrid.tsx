import { Text, View, useWindowDimensions } from "react-native";
import { Typography } from "@/components/atoms/Typography";

export type Stat = { label: string; value: string; accent?: boolean };

/** Label-over-value columns without tile chrome; whitespace does the separating. */
export function StatGrid({ stats }: { stats: Stat[] }) {
  const { fontScale } = useWindowDimensions();
  return (
    <View className="flex-row flex-wrap gap-y-4">
      {stats.map((stat) => (
        <View
          key={stat.label}
          className="min-w-[33%] flex-1 gap-1 pr-2"
          accessible
          accessibilityLabel={`${stat.label}: ${stat.value}`}
        >
          <Typography variant="label11">{stat.label}</Typography>
          <Text
            key={fontScale}
            numberOfLines={1}
            className={`font-sans text-[16px] ${stat.accent ? "text-neon" : "text-text"}`}
            style={{ fontVariant: ["tabular-nums"] }}
          >
            {stat.value}
          </Text>
        </View>
      ))}
    </View>
  );
}
