import { Text, View, useWindowDimensions } from "react-native";
export function Badge({ label, negative = false }: { label: string; negative?: boolean }) {
  // Remeasure native text after Dynamic Type changes.
  const { fontScale } = useWindowDimensions();
  // Frontend: `rounded-full bg-neon/10 px-2.5 py-1 font-mono text-[11px] text-neon`.
  return (
    <View
      className={`self-start rounded-full px-2.5 py-1 ${negative ? "bg-rose/10" : "bg-neon/10"}`}
    >
      <Text
        key={fontScale}
        className={`font-sans text-[11px] ${negative ? "text-rose" : "text-neon"}`}
        style={{ fontVariant: ["tabular-nums"] }}
      >
        {label}
      </Text>
    </View>
  );
}
