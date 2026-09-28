import { Pressable, Text, useWindowDimensions } from "react-native";

export type RequestOptionProps = {
  label: string;
  selected: boolean;
  /** `radio` for the single investment range, `checkbox` for platforms. */
  kind: "radio" | "checkbox";
  onPress: () => void;
  disabled?: boolean;
};

/**
 * Frontend RequestAccess choice: ranges are `rounded-2xl` tiles, platforms are pills.
 * Selected `bg-neon/10 text-neon`, otherwise `glass-soft text-white/60`.
 */
export function RequestOption({
  label,
  selected,
  kind,
  onPress,
  disabled = false,
}: RequestOptionProps) {
  // Remeasure native text after Dynamic Type changes.
  const { fontScale } = useWindowDimensions();
  const shape = kind === "radio" ? "rounded-2xl px-4 py-3" : "rounded-full px-4 py-2.5";
  const surface = selected ? "border-transparent bg-neon/10" : "border-borderSoft bg-glassSoft";
  return (
    <Pressable
      accessibilityRole={kind}
      accessibilityLabel={label}
      accessibilityState={{ checked: selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      className={`min-h-11 justify-center border active:opacity-80 ${shape} ${surface} ${disabled ? "opacity-50" : ""}`}
    >
      <Text
        key={fontScale}
        className={`font-sans text-[13px] ${selected ? "text-neon" : "text-fg-55"}`}
      >
        {label}
      </Text>
    </Pressable>
  );
}
