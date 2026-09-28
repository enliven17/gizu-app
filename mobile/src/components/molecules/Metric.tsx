import { Text, View, useWindowDimensions } from "react-native";
import { Typography } from "@/components/atoms/Typography";

export type MetricProps = {
  label: string;
  value: string;
  emphasis?: boolean;
  /** Frontend stat tile: value over a small uppercase label, in a glass card. */
  tile?: boolean;
  /** Tile value in the neon accent (frontend Net APY). */
  accent?: boolean;
};

function MetricTile({ label, value, accent = false }: Omit<MetricProps, "emphasis" | "tile">) {
  // Remeasure native text after Dynamic Type changes.
  const { fontScale } = useWindowDimensions();
  // Frontend: `SpotlightCard px-4 py-5`, 19px mono value, 9px tracked label.
  return (
    <View className="grow gap-2.5 rounded-card border border-glassBorder bg-glass px-4 py-5">
      <Text
        key={fontScale}
        className={`font-sans text-[19px] font-normal ios:tracking-tight ${accent ? "text-neon" : "text-fg-85"}`}
        style={{ fontVariant: ["tabular-nums"] }}
      >
        {value}
      </Text>
      <Typography variant="eyebrowSmall">{label}</Typography>
    </View>
  );
}

export function Metric({ label, value, emphasis = false, tile = false, accent }: MetricProps) {
  if (tile) return <MetricTile label={label} value={value} accent={accent} />;
  return (
    <View className={emphasis ? "gap-2" : "gap-1 rounded-3xl border border-border bg-surface p-4"}>
      <Typography variant="caption">{label}</Typography>
      <Typography variant={emphasis ? "balance" : "value"}>{value}</Typography>
    </View>
  );
}
