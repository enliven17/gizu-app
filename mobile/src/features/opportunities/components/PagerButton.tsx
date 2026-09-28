import { Text, useWindowDimensions } from "react-native";
import { PressableScale } from "@/components/atoms/PressableScale";

/** Frontend pager pill: `glass-soft rounded-full px-4 py-2 font-mono text-[10px] uppercase`. */
export function PagerButton({
  label,
  accessibilityLabel,
  disabled,
  onPress,
}: {
  label: string;
  accessibilityLabel: string;
  disabled: boolean;
  onPress: () => void;
}) {
  // Remeasure native text after Dynamic Type changes.
  const { fontScale } = useWindowDimensions();
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      className={`min-h-11 min-w-11 items-center justify-center rounded-full border border-borderSoft bg-glassSoft px-4 py-2 ${disabled ? "opacity-40" : ""}`}
    >
      <Text key={fontScale} className="font-sans text-[12px] font-medium text-fg-55">
        {label}
      </Text>
    </PressableScale>
  );
}
