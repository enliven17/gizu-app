import { Text, useWindowDimensions, type TextProps } from "react-native";

/** Frontend list status line: centered, 11px uppercase, wide tracking, dimmed. */
export function CatalogStatus(props: TextProps) {
  // Remeasure native text after Dynamic Type changes.
  const { fontScale } = useWindowDimensions();
  return (
    <Text
      key={fontScale}
      {...props}
      className="font-sans py-6 text-center text-[12px] text-fg-55"
    />
  );
}
