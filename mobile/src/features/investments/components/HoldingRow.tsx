import { Text, View, useWindowDimensions } from "react-native";
import { PressableScale } from "@/components/atoms/PressableScale";
import { Typography } from "@/components/atoms/Typography";
import { dollars, type Holding } from "@/domain/investments";

const tabular = { fontVariant: ["tabular-nums" as const] };

/** Frontend Home holding row inside the `glass divide-y divide-white/5` list. */
export function HoldingRow({
  holding,
  last,
  onOpen,
}: {
  holding: Holding;
  last: boolean;
  onOpen: (id: string) => void;
}) {
  const { fontScale } = useWindowDimensions();
  const up = Number(holding.change) >= 0;
  const change = `${up && !holding.change.startsWith("+") ? "+" : ""}${holding.change}%`;
  const value = dollars(holding.valueCents);
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={`Open ${holding.ticker} holding`}
      accessibilityHint={`${holding.name}, ${value}, ${change}`}
      onPress={() => onOpen(holding.id)}
      pressedScale={0.99}
    >
      <View
        className={`min-h-14 flex-row flex-wrap items-center justify-between gap-3 px-5 py-4 ${last ? "" : "border-b border-divider"}`}
      >
        <View className="min-w-0 flex-1 gap-0.5">
          <Typography variant="rowTitle">{holding.name}</Typography>
          <Text key={fontScale} className="font-sans text-[10px] text-fg-35" style={tabular}>
            {`${holding.units} units`}
          </Text>
        </View>
        <View className="shrink items-end">
          <Text
            key={`value-${fontScale}`}
            className="font-sans text-[14px] font-normal text-text"
            style={tabular}
          >
            {value}
          </Text>
          <Text
            key={`change-${fontScale}`}
            className={`font-sans text-[10px] ${up ? "text-neon/70" : "text-rose/80"}`}
            style={tabular}
          >
            {change}
          </Text>
        </View>
      </View>
    </PressableScale>
  );
}
