import { Text, useWindowDimensions } from "react-native";
import { CheckCheck } from "lucide-react-native";
import { PressableScale } from "@/components/atoms/PressableScale";
import colors from "@/theme/colors.json";

// Frontend `glass-soft h-11 rounded-2xl px-4` mark-all pill, in normal case.
export function MarkAllButton({ disabled, onPress }: { disabled: boolean; onPress: () => void }) {
  // Remeasure native text after Dynamic Type changes.
  const { fontScale } = useWindowDimensions();
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel="Mark all as read"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={4}
      className={`min-h-11 flex-row items-center gap-2 rounded-2xl border border-borderSoft bg-glassSoft px-4 ${disabled ? "opacity-50" : ""}`}
    >
      <CheckCheck size={14} color={colors.fg["55"]} />
      <Text key={fontScale} className="font-sans text-[13px] font-medium text-fg-55">
        Mark all as read
      </Text>
    </PressableScale>
  );
}
