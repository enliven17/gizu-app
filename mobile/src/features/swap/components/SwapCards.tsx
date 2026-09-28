import type { ReactNode } from "react";
import { Text, TextInput, View, useWindowDimensions } from "react-native";
import { ArrowDown } from "lucide-react-native";
import { PressableScale } from "@/components/atoms/PressableScale";
import { Typography } from "@/components/atoms/Typography";
import colors from "@/theme/colors.json";

const tabular = { fontVariant: ["tabular-nums" as const] };

/** Frontend Exchange card: rounded 28px glass panel with a caption row. */
function SwapCard({
  label,
  aside,
  children,
}: {
  label: string;
  aside: string;
  children: ReactNode;
}) {
  return (
    <View className="gap-4 rounded-[28px] border border-glassBorder bg-glass px-6 py-6">
      <View className="flex-row flex-wrap items-center justify-between gap-2">
        <Typography variant="micro">{label}</Typography>
        <Typography variant="micro">{aside}</Typography>
      </View>
      {children}
    </View>
  );
}

function UnitPill({ unit, accent = false }: { unit: string; accent?: boolean }) {
  return (
    <View className="min-h-11 shrink-0 justify-center rounded-full border border-borderSoft bg-glassSoft px-4">
      <Typography variant="eyebrow" className={accent ? "!text-neon" : "!text-text"}>
        {unit}
      </Typography>
    </View>
  );
}

const QUICK_FILL = [25, 50, 75, 100] as const;

export type PayCardProps = {
  amount: string;
  available: string;
  editable: boolean;
  onChange: (value: string) => void;
  onQuickFill: (percentage: number) => void;
};

/** "You pay" card: 40px amount, USDG pill and 25/50/75/Max chips. */
export function PayCard({ amount, available, editable, onChange, onQuickFill }: PayCardProps) {
  return (
    <SwapCard label="You pay" aside={available}>
      <View className="flex-row items-center gap-4">
        <TextInput
          accessibilityLabel="Amount in USDG"
          value={amount}
          onChangeText={onChange}
          editable={editable}
          keyboardType="decimal-pad"
          placeholder="0"
          placeholderTextColor={colors.fg["20"]}
          selectionColor={colors.accent}
          cursorColor={colors.accent}
          maxLength={20}
          className="font-sans min-h-14 min-w-0 flex-1 text-[40px] font-normal text-text"
          style={tabular}
        />
        <UnitPill unit="USDG" />
      </View>
      <View className="flex-row gap-2">
        {QUICK_FILL.map((p) => {
          const label = p === 100 ? "Max" : `${p}%`;
          return (
            <PressableScale
              key={p}
              accessibilityRole="button"
              accessibilityLabel={label}
              accessibilityState={{ disabled: !editable }}
              disabled={!editable}
              onPress={() => onQuickFill(p)}
              className={`min-h-11 flex-1 items-center justify-center rounded-xl border border-borderSoft bg-glassSoft ${editable ? "" : "opacity-50"}`}
            >
              <Typography variant="eyebrowSmall">{label}</Typography>
            </PressableScale>
          );
        })}
      </View>
    </SwapCard>
  );
}

/**
 * Direction marker between the cards. Only USDG → stock token is supported, so this is
 * a static indicator rather than the frontend's flip button.
 */
export function DirectionMarker() {
  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      // 40dp circle; -my-5 cancels its height so the cards sit 8dp apart like the frontend.
      className="z-10 -my-5 items-center"
      style={{ elevation: 2 }}
    >
      <View className="h-10 w-10 items-center justify-center rounded-full border border-glassBorder bg-surface">
        <ArrowDown size={16} color={colors.neon.DEFAULT} />
      </View>
    </View>
  );
}

/** "You receive" card: estimated output and the selected token pill. */
export function ReceiveCard({
  estimate,
  symbol,
  name,
}: {
  estimate: string;
  symbol: string;
  name: string;
}) {
  const { fontScale } = useWindowDimensions();
  return (
    <SwapCard label="You receive" aside="Estimate">
      <View className="flex-row items-center gap-4">
        <Text
          key={fontScale}
          numberOfLines={1}
          adjustsFontSizeToFit
          className="font-sans min-w-0 flex-1 text-[40px] font-normal text-fg-85"
          style={tabular}
        >
          {estimate}
        </Text>
        <UnitPill unit={symbol} accent />
      </View>
      <Typography variant="caption" className="!text-fg-35" numberOfLines={1}>
        {name}
      </Typography>
    </SwapCard>
  );
}
