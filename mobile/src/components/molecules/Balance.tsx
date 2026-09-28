import { Text, useWindowDimensions } from "react-native";

/**
 * Frontend Home balance: 46px whole part with dim 26px cents. Cents stay nested in the
 * same Text so the value reads (and is found) as one string.
 */
export function Balance({ value }: { value: string }) {
  // Remeasure native text after Dynamic Type changes.
  const { fontScale } = useWindowDimensions();
  const [whole, cents] = value.split(".");
  return (
    <Text
      key={fontScale}
      accessibilityLabel={value}
      className="font-sans text-[46px] font-normal leading-[52px] ios:tracking-tight text-text"
      style={{ fontVariant: ["tabular-nums"] }}
    >
      {whole}
      {cents && <Text className="font-sans text-[26px] font-normal text-fg-35">.{cents}</Text>}
    </Text>
  );
}
