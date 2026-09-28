import type { PropsWithChildren, ReactNode } from "react";
import { TextInput, View } from "react-native";
import { PressableScale } from "@/components/atoms/PressableScale";
import { Typography } from "@/components/atoms/Typography";
import colors from "@/theme/colors.json";

/** Web TransferSheet panel: glass, 36px top radius, rising from the bottom edge. */
export function Sheet({ children }: PropsWithChildren) {
  return (
    <View className="-mx-5 -mb-4 mt-2 grow gap-4 rounded-t-sheet border border-b-0 border-glassBorder bg-glass px-5 pb-8 pt-5">
      {children}
    </View>
  );
}

type AmountFieldProps = {
  unit: string;
  label: string;
  available: string;
  value: string;
  onChange: (value: string) => void;
  editable: boolean;
};

/** Web amount card: caption row, 30px amount and a unit pill. */
export function AmountField({
  unit,
  label,
  available,
  value,
  onChange,
  editable,
}: AmountFieldProps) {
  return (
    <View className="gap-2 rounded-card border border-borderSoft bg-glassSoft px-5 py-4">
      <View className="flex-row flex-wrap items-center justify-between gap-2">
        <Typography variant="micro">{label}</Typography>
        <Typography variant="micro">{available}</Typography>
      </View>
      <View className="flex-row items-center gap-3">
        <TextInput
          accessibilityLabel={`Amount in ${unit}`}
          value={value}
          onChangeText={onChange}
          editable={editable}
          keyboardType="decimal-pad"
          placeholder="0"
          placeholderTextColor={colors.fg["20"]}
          selectionColor={colors.accent}
          cursorColor={colors.accent}
          maxLength={25}
          className="font-sans min-h-14 min-w-0 flex-1 text-[30px] font-normal text-text"
        />
        <View className="shrink-0 rounded-full border border-glassBorder bg-glass px-3 py-2">
          <Typography variant="eyebrow" className="!text-text">
            {unit}
          </Typography>
        </View>
      </View>
    </View>
  );
}

const PERCENTAGES = [25, 50, 75, 100] as const;

/** Web quick-fill chips; Max reserves fees in the controller. */
export function PercentChips({
  disabled,
  onSelect,
}: {
  disabled: boolean;
  onSelect: (percentage: number) => void;
}) {
  return (
    <View className="flex-row gap-2">
      {PERCENTAGES.map((p) => {
        const label = p === 100 ? "Max" : `${p}%`;
        return (
          <PressableScale
            key={p}
            accessibilityRole="button"
            accessibilityLabel={label}
            accessibilityState={{ disabled }}
            disabled={disabled}
            onPress={() => onSelect(p)}
            className={`min-h-11 flex-1 items-center justify-center rounded-xl border border-borderSoft bg-glassSoft ${disabled ? "opacity-50" : ""}`}
          >
            <Typography variant="eyebrowSmall">{label}</Typography>
          </PressableScale>
        );
      })}
    </View>
  );
}

/** Soft glass row, e.g. the funding route. */
export function SheetRow({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <View className="flex-row items-center gap-4 rounded-2xl border border-borderSoft bg-glassSoft px-5 py-4">
      {icon}
      <View className="min-w-0 flex-1">{children}</View>
    </View>
  );
}

/** Web review list: quiet key on the left, value on the right. */
export function ReviewRows({ rows }: { rows: readonly (readonly [string, string])[] }) {
  return (
    <View className="gap-2.5 px-1">
      {rows.map(([label, value]) => (
        <View key={label} className="flex-row flex-wrap justify-between gap-x-4 gap-y-1">
          <Typography variant="rowValue" className="!text-fg-45">
            {label}
          </Typography>
          <Typography variant="rowValue" className="shrink text-right !text-fg-70">
            {value}
          </Typography>
        </View>
      ))}
    </View>
  );
}
