import { TextInput } from "react-native";
import colors from "@/theme/colors.json";
export function SearchInput({
  value,
  onChangeText,
  label,
}: {
  value: string;
  onChangeText: (value: string) => void;
  label: string;
}) {
  return (
    <TextInput
      accessibilityLabel={label}
      placeholder={label}
      placeholderTextColor={colors.fg["35"]}
      selectionColor={colors.accent}
      value={value}
      onChangeText={onChangeText}
      autoCorrect={false}
      autoCapitalize="none"
      returnKeyType="search"
      className="font-sans min-h-11 rounded-2xl border border-borderSoft bg-glassSoft px-4 py-3 text-[14px] text-text"
    />
  );
}
