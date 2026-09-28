import { View } from "react-native";
import { PressableScale } from "@/components/atoms/PressableScale";
import { Typography } from "@/components/atoms/Typography";

// Frontend SubPage option row: 14px label, faint divider, neon selection mark.
export function PreferenceOption({
  label,
  selected,
  disabled = false,
  onSelect,
}: {
  label: string;
  selected: boolean;
  disabled?: boolean;
  onSelect: () => void;
}) {
  return (
    <PressableScale
      accessibilityRole="radio"
      accessibilityLabel={label}
      accessibilityState={{ checked: selected, disabled }}
      disabled={disabled}
      onPress={onSelect}
      pressedScale={0.99}
    >
      <View
        className={`min-h-14 flex-row flex-wrap items-center gap-3 border-b border-divider px-5 py-4 ${disabled && !selected ? "opacity-60" : ""}`}
      >
        <Typography variant="rowTitle" className="min-w-0 flex-1">
          {label}
        </Typography>
        {disabled && !selected && (
          <Typography variant="rowValue" className="!text-[12px] !text-fg-45">
            Unavailable
          </Typography>
        )}
        <View
          className={`h-5 w-5 items-center justify-center rounded-full border ${selected ? "border-neon" : "border-fg-20"}`}
        >
          {selected && <View className="h-2.5 w-2.5 rounded-full bg-neon" />}
        </View>
      </View>
    </PressableScale>
  );
}
