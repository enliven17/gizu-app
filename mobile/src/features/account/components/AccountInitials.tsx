import { Text, View, useWindowDimensions } from "react-native";

/** Frontend Account card tile: `h-14 w-14 rounded-2xl bg-neon/10 text-[15px] text-neon`. */
export function AccountInitials({ initials }: { initials: string }) {
  // Remeasure native text after Dynamic Type changes.
  const { fontScale } = useWindowDimensions();
  return (
    <View
      className="h-14 w-14 items-center justify-center rounded-2xl bg-neon/10"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Text
        key={fontScale}
        className="font-sans text-[15px] text-neon"
        style={{ fontVariant: ["tabular-nums"] }}
      >
        {initials}
      </Text>
    </View>
  );
}
